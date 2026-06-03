(() => {
	const MIN_FONT_SIZE = 8;
	const MAX_FONT_SIZE = 32;
	const MAX_TEXTAREAS = 5;
	const MAX_SHARE_URL_LENGTH = 2048;
	const FIT_PRECISION = 0.1;
	const WRAP_BUFFER = 2;
	let textareaTemplate;
	let initialViewportHeight;
	let fontCssTextPromise;
	const embeddedFontCssCache = new Map();
	const fontDataUrlCache = new Map();
	const composingTextareas = new WeakSet();

	function px(value) {
		return Number.parseFloat(value) || 0;
	}

	function copyTextStyles(from, to) {
		const styles = window.getComputedStyle(from);
		for (const property of [
			"fontFamily",
			"fontWeight",
			"fontStyle",
			"fontStretch",
			"letterSpacing",
			"textTransform",
			"textIndent",
			"textOrientation",
			"writingMode",
			"wordSpacing",
		]) {
			to.style[property] = styles[property];
		}
		to.style.lineHeight =
			styles.lineHeight === "normal"
				? "normal"
				: `${px(styles.lineHeight) / px(styles.fontSize)}`;
		to.style.padding = styles.padding;
		to.style.border = styles.border;
		to.style.boxSizing = styles.boxSizing;
	}

	function getMirror() {
		let mirror = document.getElementById("textarea-fit-mirror");
		if (mirror) return mirror;

		mirror = document.createElement("textarea");
		mirror.id = "textarea-fit-mirror";
		mirror.setAttribute("aria-hidden", "true");
		mirror.setAttribute("wrap", "off");
		mirror.tabIndex = -1;
		Object.assign(mirror.style, {
			position: "absolute",
			left: "-10000px",
			top: "0",
			visibility: "hidden",
			width: "0px",
			height: "0px",
			whiteSpace: "pre",
			overflow: "visible",
			pointerEvents: "none",
			resize: "none",
		});
		document.body.appendChild(mirror);
		return mirror;
	}

	function getTextareas() {
		return [...document.querySelectorAll("textarea:not(#textarea-fit-mirror)")];
	}

	function getTextareaText(textarea) {
		return textarea.value || textarea.placeholder || " ";
	}

	function getFontStylesheetUrl() {
		return document.querySelector('link[href$="I.Ming.css"]')?.href;
	}

	function getScreenshotText() {
		const input = getTitleInput();
		return [input?.value || "", ...getTextareas().map(getTextareaText)].join(
			"",
		);
	}

	function getTitleInput() {
		return document.querySelector("body > div input");
	}

	function decodeUrlText(text) {
		try {
			return decodeURIComponent(text.replace(/\+/g, " "));
		} catch (error) {
			console.warn("Unable to decode text from URL.", error);
			return text;
		}
	}

	function bytesToBase64(bytes) {
		const chunkSize = 0x8000;
		let binary = "";
		for (let index = 0; index < bytes.length; index += chunkSize) {
			binary += String.fromCharCode(
				...bytes.subarray(index, index + chunkSize),
			);
		}

		return btoa(binary);
	}

	function base64ToBytes(base64) {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) {
			bytes[index] = binary.charCodeAt(index);
		}

		return bytes;
	}

	function encodeTextSegment(text) {
		return bytesToBase64(new TextEncoder().encode(text))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replace(/=+$/, "");
	}

	function decodeTextSegment(text) {
		try {
			const normalizedText = text.replace(/=+$/, "");
			const base64 = normalizedText.replaceAll("-", "+").replaceAll("_", "/");
			const padding = "=".repeat((4 - (base64.length % 4)) % 4);
			const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(
				base64ToBytes(base64 + padding),
			);
			if (encodeTextSegment(decodedText) !== normalizedText) {
				throw new Error("Not a canonical base64url text segment.");
			}

			return decodedText;
		} catch {
			return "";
		}
	}

	function isUrlParameter(part, name) {
		return part === name || part.startsWith(`${name}=`);
	}

	function getUrlOptions() {
		const query = window.location.search.slice(1);
		const options = {
			canEdit: false,
			bgOption: 0,
			hasBgOption: false,
			hasTitle: false,
			hasText: false,
			segments: [],
			title: "",
		};
		if (!query) return options;

		let collectingText = false;
		for (const part of query.split("&")) {
			if (isUrlParameter(part, "edit")) {
				options.canEdit = true;
				continue;
			}

			if (isUrlParameter(part, "bg")) {
				const bgOption = Number.parseInt(
					decodeUrlText(part.slice("bg=".length)),
					10,
				);
				if (!Number.isNaN(bgOption)) {
					options.bgOption = bgOption;
					options.hasBgOption = true;
				}
				continue;
			}

			if (isUrlParameter(part, "title")) {
				options.hasTitle = true;
				options.title = decodeUrlText(part.slice("title=".length));
				continue;
			}

			if (isUrlParameter(part, "text")) {
				options.hasText = true;
				collectingText = true;
				options.segments.push(decodeTextSegment(part.slice("text=".length)));
				continue;
			}

			if (collectingText) {
				options.segments.push(decodeTextSegment(part));
			}
		}

		options.segments = options.segments.slice(0, MAX_TEXTAREAS);
		return options;
	}

	function applyUrlOptions() {
		const options = getUrlOptions();
		if (!options.hasText && !options.hasTitle && !options.hasBgOption) return;

		const input = getTitleInput();
		if (input && options.hasTitle) input.value = options.title;

		const select = document.getElementById("background-color");
		if (
			select &&
			options.hasBgOption &&
			options.bgOption >= 0 &&
			options.bgOption < select.options.length
		) {
			select.selectedIndex = options.bgOption;
			applyBackgroundColor(select);
		}

		const textareas = getTextareas();
		const firstTextarea = textareas[0];
		const button = document.getElementById("add-textarea");
		if (!firstTextarea || !button) return;

		if (options.hasText) {
			const segments = options.segments.length ? options.segments : [""];
			firstTextarea.value = segments[0];
			textareas.slice(1).forEach((textarea) => textarea.remove());

			for (const segment of segments.slice(1)) {
				const textarea = textareaTemplate
					? textareaTemplate.cloneNode(false)
					: document.createElement("textarea");
				textarea.value = segment;
				button.before(textarea);
			}
		}

		if (!options.canEdit) {
			document.documentElement.classList.add("is-capturing");
			if (input) input.readOnly = true;
			getTextareas().forEach((textarea) => {
				textarea.readOnly = true;
			});
		}
	}

	function getShareUrl() {
		const segments = getTextareas().map(getTextareaText);
		const title = getTitleInput()?.value || "";
		const bgOption =
			document.getElementById("background-color")?.selectedIndex || 0;

		const baseUrl = `${window.location.origin}${window.location.pathname}`;
		const params = [];
		if (bgOption > 0) params.push(`bg=${bgOption}`);
		if (title) params.push(`title=${encodeURIComponent(title)}`);
		if (segments.length) {
			params.push(`text=${segments.map(encodeTextSegment).join("&")}`);
		}

		return params.length ? `${baseUrl}?${params.join("&")}` : baseUrl;
	}

	function getUsedCodePoints() {
		const codePoints = new Set();
		for (const character of getScreenshotText()) {
			codePoints.add(character.codePointAt(0));
		}
		return codePoints;
	}

	function unicodeRangeMatches(rangeText, codePoints) {
		if (!rangeText) return true;

		for (const range of rangeText.split(",")) {
			const match = range.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i);
			if (!match) continue;

			if (match[1].includes("?")) {
				const start = Number.parseInt(match[1].replaceAll("?", "0"), 16);
				const end = Number.parseInt(match[1].replaceAll("?", "F"), 16);
				for (const codePoint of codePoints) {
					if (codePoint >= start && codePoint <= end) return true;
				}
				continue;
			}

			const start = Number.parseInt(match[1], 16);
			const end = match[2] ? Number.parseInt(match[2], 16) : start;
			for (const codePoint of codePoints) {
				if (codePoint >= start && codePoint <= end) return true;
			}
		}

		return false;
	}

	function arrayBufferToBase64(buffer) {
		return bytesToBase64(new Uint8Array(buffer));
	}

	async function getFontDataUrl(url) {
		if (!fontDataUrlCache.has(url)) {
			fontDataUrlCache.set(
				url,
				fetch(url)
					.then((response) => response.arrayBuffer())
					.then(
						(buffer) => `data:font/woff2;base64,${arrayBufferToBase64(buffer)}`,
					),
			);
		}

		return fontDataUrlCache.get(url);
	}

	async function embedFontFaceBlock(block, baseUrl) {
		let embeddedBlock = block;
		const urls = [...block.matchAll(/url\((['"]?)([^'")]+\.woff2)\1\)/g)].map(
			(match) => match[2],
		);

		for (const url of urls) {
			const absoluteUrl = new URL(url, baseUrl).href;
			embeddedBlock = embeddedBlock.replaceAll(
				url,
				await getFontDataUrl(absoluteUrl),
			);
		}

		return embeddedBlock;
	}

	async function getEmbeddedFontCss() {
		const stylesheetUrl = getFontStylesheetUrl();
		if (!stylesheetUrl) return "";

		const codePoints = getUsedCodePoints();
		const cacheKey = [...codePoints].sort((a, b) => a - b).join(",");
		if (embeddedFontCssCache.has(cacheKey))
			return embeddedFontCssCache.get(cacheKey);

		try {
			fontCssTextPromise ||= fetch(stylesheetUrl).then((response) =>
				response.text(),
			);
			const cssText = await fontCssTextPromise;
			const blocks = cssText.match(/@font-face\s*{[\s\S]*?}/g) || [];
			const matchingBlocks = blocks.filter((block) => {
				const range = block.match(/unicode-range:\s*([^;]+);/i)?.[1];
				return unicodeRangeMatches(range, codePoints);
			});
			const embeddedCss = (
				await Promise.all(
					matchingBlocks.map((block) =>
						embedFontFaceBlock(block, stylesheetUrl),
					),
				)
			).join("\n");

			embeddedFontCssCache.set(cacheKey, embeddedCss);
			return embeddedCss;
		} catch (error) {
			console.warn("Unable to embed web font for screenshot.", error);
			return "";
		}
	}

	function getViewportHeight() {
		return window.innerHeight || document.documentElement.clientHeight;
	}

	function prepareTextarea(textarea) {
		textarea.setAttribute("wrap", "off");
		textarea.style.boxSizing = "border-box";
		textarea.style.paddingBlockStart = "0px";
		textarea.style.paddingBlockEnd = "0px";
		textarea.style.whiteSpace = "pre";
		textarea.style.overflow = "hidden";
	}

	function measure(textarea, fontSize) {
		const mirror = getMirror();
		copyTextStyles(textarea, mirror);
		mirror.style.fontSize = `${fontSize}px`;
		mirror.style.padding = "0px";
		mirror.style.paddingBlockStart = "0px";
		mirror.style.paddingBlockEnd = "0px";
		mirror.style.whiteSpace = "pre";
		mirror.value = getTextareaText(textarea);

		return {
			width: mirror.scrollWidth,
			height: mirror.scrollHeight,
		};
	}

	function getTextareaMetrics(textareas, fontSize) {
		let allFitWidth = true;
		let maxTextWidth = 0;
		let maxHeight = 0;
		let minTargetWidth = Infinity;

		for (const textarea of textareas) {
			const styles = window.getComputedStyle(textarea);
			const borderX = px(styles.borderLeftWidth) + px(styles.borderRightWidth);
			const borderY = px(styles.borderTopWidth) + px(styles.borderBottomWidth);
			const targetWidth =
				(textarea.getBoundingClientRect().width || textarea.clientWidth) -
				borderX;
			const fitWidth = Math.max(0, targetWidth - WRAP_BUFFER);
			const size = measure(textarea, fontSize);
			const textWidth = size.width;

			minTargetWidth = Math.min(minTargetWidth, targetWidth);
			maxTextWidth = Math.max(maxTextWidth, textWidth);
			maxHeight = Math.max(maxHeight, Math.ceil(size.height + borderY));
			allFitWidth &&= textWidth <= fitWidth;
		}

		return { allFitWidth, maxTextWidth, maxHeight, minTargetWidth };
	}

	function findSharedFontSize(textareas) {
		let low = MIN_FONT_SIZE;
		let high = MAX_FONT_SIZE;

		while (high - low > FIT_PRECISION) {
			const mid = (low + high) / 2;
			if (getTextareaMetrics(textareas, mid).allFitWidth) {
				low = mid;
			} else {
				high = mid;
			}
		}

		return Math.max(MIN_FONT_SIZE, low);
	}

	function applySharedLayout(textareas, fontSize) {
		const metrics = getTextareaMetrics(textareas, fontSize);
		const sidePadding = Math.max(
			0,
			(metrics.minTargetWidth - metrics.maxTextWidth) / 2,
		);

		for (const textarea of textareas) {
			textarea.style.fontSize = `${fontSize}px`;
			textarea.style.height = `${metrics.maxHeight}px`;
			textarea.style.paddingBlockStart = `${sidePadding}px`;
			textarea.style.paddingBlockEnd = `${sidePadding}px`;
		}
	}

	function fitAllTextareas() {
		const textareas = getTextareas();
		if (!textareas.length) return;

		const button = document.getElementById("add-textarea");
		if (button) {
			button.hidden =
				document.documentElement.classList.contains("is-capturing") ||
				textareas.length >= MAX_TEXTAREAS;
		}

		textareas.forEach(prepareTextarea);

		const viewportHeight = initialViewportHeight || getViewportHeight();
		let fontSize = findSharedFontSize(textareas);
		applySharedLayout(textareas, fontSize);

		for (let attempts = 0; attempts < 10; attempts++) {
			const pageHeight = document.documentElement.scrollHeight;
			if (pageHeight <= viewportHeight || fontSize <= MIN_FONT_SIZE) break;

			fontSize = Math.max(
				MIN_FONT_SIZE,
				fontSize * (viewportHeight / pageHeight) * 0.98,
			);
			applySharedLayout(textareas, fontSize);
		}

		const input = getTitleInput();
		if (input) input.style.fontSize = `${fontSize}px`;
	}

	function handleTextareaInput(event) {
		const textarea = event.currentTarget;
		if (
			!event.isComposing &&
			!composingTextareas.has(textarea) &&
			textarea.value === "" &&
			getTextareas().length > 1
		) {
			textarea.remove();
		}

		fitAllTextareas();
	}

	function handleCompositionStart(event) {
		composingTextareas.add(event.currentTarget);
	}

	function handleCompositionEnd(event) {
		composingTextareas.delete(event.currentTarget);
		fitAllTextareas();
	}

	function bindTextarea(textarea) {
		textarea.addEventListener("input", handleTextareaInput);
		textarea.addEventListener("compositionstart", handleCompositionStart);
		textarea.addEventListener("compositionend", handleCompositionEnd);
	}

	function createTextarea() {
		if (getTextareas().length >= MAX_TEXTAREAS) return;

		const textarea = textareaTemplate
			? textareaTemplate.cloneNode(false)
			: document.createElement("textarea");
		textarea.value = "";
		const button = document.getElementById("add-textarea");
		button.before(textarea);
		bindTextarea(textarea);
		fitAllTextareas();
		textarea.focus();
		textarea.select();
	}

	function applyBackgroundColor(select) {
		document.documentElement.style.backgroundColor = select.value;
	}

	function showScreenshot(dataUrl) {
		let preview = document.querySelector("dialog");
		let link = preview?.querySelector("a");
		let image = preview?.querySelector("img");
		let hint = preview?.querySelector("p");
		let shareInput = preview?.querySelector("input");

		if (!preview) {
			preview = document.createElement("dialog");
			preview.addEventListener("click", (event) => {
				if (event.target === preview) preview.close();
			});
			document.body.appendChild(preview);
		}

		if (!link) {
			link = document.createElement("a");
			link.download = "shiu.png";
			preview.appendChild(link);
		}

		if (!image) {
			image = document.createElement("img");
			link.appendChild(image);
		}

		if (!hint) {
			hint = document.createElement("p");
			hint.textContent = "長 觸 存 之";
			preview.appendChild(hint);
		}
		preview.insertBefore(hint, link);

		if (!shareInput) {
			shareInput = document.createElement("input");
			shareInput.readOnly = true;
			shareInput.addEventListener("click", () => shareInput.select());
			preview.appendChild(shareInput);
		}

		const shareUrl = getShareUrl();
		link.href = dataUrl;
		image.src = dataUrl;
		shareInput.hidden = shareUrl.length > MAX_SHARE_URL_LENGTH;
		if (!shareInput.hidden) {
			shareInput.value = shareUrl;
			shareInput.title = shareUrl;
		}
		if (typeof preview.showModal === "function") {
			preview.showModal();
		} else {
			preview.setAttribute("open", "");
		}
	}

	async function saveScreenshot() {
		if (!window.htmlToImage) return;

		await document.fonts?.ready;
		const fontEmbedCSS = await getEmbeddedFontCss();
		const rootStyles = getComputedStyle(document.documentElement);
		const addButton = document.getElementById("add-textarea");
		const paddingX = px(rootStyles.paddingLeft) + px(rootStyles.paddingRight);
		const fullWidth = document.documentElement.scrollWidth;
		const width = Math.min(fullWidth, px(rootStyles.width) + paddingX);
		const height = Math.max(
			0,
			document.documentElement.scrollHeight - (addButton.hidden ? 0 : 35),
		);
		document.documentElement.classList.add("is-capturing");

		try {
			const ratio = window.devicePixelRatio || 1;
			const canvas = await window.htmlToImage.toCanvas(
				document.documentElement,
				{
					backgroundColor: rootStyles.backgroundColor,
					canvasHeight: document.documentElement.scrollHeight,
					canvasWidth: fullWidth,
					filter: (node) => node !== addButton,
					pixelRatio: ratio,
					width: fullWidth,
					...(fontEmbedCSS ? { fontEmbedCSS } : {}),
				},
			);
			const croppedCanvas = document.createElement("canvas");
			const croppedContext = croppedCanvas.getContext("2d");
			const sourceX = ((canvas.width / ratio - width) / 2) * ratio;
			const outputWidth = Math.max(width, height);
			const horizontalPadding = ((outputWidth - width) / 2) * ratio;

			croppedCanvas.width = outputWidth * ratio;
			croppedCanvas.height = height * ratio;
			croppedContext.fillStyle = rootStyles.backgroundColor;
			croppedContext.fillRect(0, 0, croppedCanvas.width, croppedCanvas.height);
			croppedContext.drawImage(
				canvas,
				sourceX,
				0,
				width * ratio,
				croppedCanvas.height,
				horizontalPadding,
				0,
				width * ratio,
				croppedCanvas.height,
			);
			showScreenshot(croppedCanvas.toDataURL("image/png"));
		} finally {
			document.documentElement.classList.remove("is-capturing");
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		initialViewportHeight = getViewportHeight();
		textareaTemplate = document.querySelector("textarea")?.cloneNode(false);
		if (textareaTemplate) {
			textareaTemplate.value = "";
		}

		applyUrlOptions();
		getTextareas().forEach(bindTextarea);
		document
			.getElementById("background-color")
			?.addEventListener("change", (event) =>
				applyBackgroundColor(event.currentTarget),
			);
		document
			.getElementById("save-screenshot")
			?.addEventListener("click", saveScreenshot);
		document
			.getElementById("add-textarea")
			?.addEventListener("click", createTextarea);
		window.addEventListener("resize", fitAllTextareas);
		document.fonts?.ready.then(fitAllTextareas);
		fitAllTextareas();
	});
})();
