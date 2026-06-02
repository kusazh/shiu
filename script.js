(() => {
	const MIN_FONT_SIZE = 8;
	const MAX_FONT_SIZE = 32;
	const MAX_TEXTAREAS = 5;
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
		const input = document.querySelector("input");
		return [input?.value || "", ...getTextareas().map(getTextareaText)].join(
			"",
		);
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
		const bytes = new Uint8Array(buffer);
		const chunkSize = 0x8000;
		let binary = "";

		for (let index = 0; index < bytes.length; index += chunkSize) {
			binary += String.fromCharCode(
				...bytes.subarray(index, index + chunkSize),
			);
		}

		return btoa(binary);
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

	function getInitialViewportHeight() {
		if (!initialViewportHeight) {
			initialViewportHeight = getViewportHeight();
		}

		return initialViewportHeight;
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

	function getTextBlockWidth(textarea, fontSize) {
		return measure(textarea, fontSize).width;
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
			const textWidth = getTextBlockWidth(textarea, fontSize);

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

		return { ...metrics, sidePadding };
	}

	function fitAllTextareas() {
		const textareas = getTextareas();
		if (!textareas.length) return;

		const button = document.getElementById("add-textarea");
		if (button) button.hidden = textareas.length >= MAX_TEXTAREAS;

		textareas.forEach(prepareTextarea);

		const viewportHeight = getInitialViewportHeight();
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

		const input = document.querySelector("input");
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
		textarea.textContent = "";
		const button = document.getElementById("add-textarea");
		button.before(textarea);
		bindTextarea(textarea);
		fitAllTextareas();
		textarea.focus();
		textarea.select();
	}

	function updateBackgroundColor(event) {
		document.documentElement.style.backgroundColor = event.currentTarget.value;
	}

	function showScreenshot(dataUrl) {
		let preview = document.getElementById("screenshot-preview");
		let link = document.getElementById("screenshot-link");
		let image = document.getElementById("screenshot-image");
		let hint = document.getElementById("screenshot-hint");

		if (!preview) {
			preview = document.createElement("dialog");
			preview.id = "screenshot-preview";
			preview.addEventListener("click", (event) => {
				if (event.target === preview) preview.close();
			});
			document.body.appendChild(preview);
		}

		if (!link) {
			link = document.createElement("a");
			link.id = "screenshot-link";
			link.download = "shiu.png";
			preview.appendChild(link);
		}

		if (!image) {
			image = document.createElement("img");
			image.id = "screenshot-image";
			link.appendChild(image);
		}

		if (!hint) {
			hint = document.createElement("p");
			hint.id = "screenshot-hint";
			hint.textContent = "長 觸 存 之";
			preview.appendChild(hint);
		}

		link.href = dataUrl;
		image.src = dataUrl;
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

			croppedCanvas.width = width * ratio;
			croppedCanvas.height = height * ratio;
			croppedContext.drawImage(
				canvas,
				sourceX,
				0,
				croppedCanvas.width,
				croppedCanvas.height,
				0,
				0,
				croppedCanvas.width,
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
			textareaTemplate.textContent = "";
		}

		getTextareas().forEach(bindTextarea);
		document
			.getElementById("background-color")
			?.addEventListener("change", updateBackgroundColor);
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
