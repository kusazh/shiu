(() => {
	const MIN_FONT_SIZE = 8;
	const MAX_FONT_SIZE = 32;
	const MAX_TEXTAREAS = 5;
	const MAX_URL = 2048;
	const PRECISION = 0.1;
	const WRAP_BUFFER = 2;
	let textareaTpl;
	let kujiRows;
	let kujiNo;
	let viewHeight;
	let fontCss;
	const cssCache = new Map();
	const fontCache = new Map();
	const composing = new WeakSet();
	let kujiTimer;

	function px(value) {
		return Number.parseFloat(value) || 0;
	}

	function copyStyles(from, to) {
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

	function getFontSheet() {
		return document.querySelector('link[href$="I.Ming.css"]')?.href;
	}

	function getShotText() {
		const el = getTitleInput();
		return [el?.value || "", ...getTextareas().map(getTextareaText)].join("");
	}

	function getTitleInput() {
		return document.querySelector("header input");
	}

	function showKuji(button, { transition = true } = {}) {
		clearTimeout(kujiTimer);
		button.disabled = false;
		button.classList.toggle("waiting", transition);
		button.hidden = false;
		button.style.removeProperty("opacity");
		button.style.removeProperty("transition");
		if (transition) {
			kujiTimer = setTimeout(() => {
				button.classList.remove("waiting");
			}, 5000);
			button.addEventListener("transitionend", () => {
				button.style.transition = "none";
			});
		}
	}

	function hideKuji() {
		const button = document.getElementById("kuji");

		if (!button) return;
		clearTimeout(kujiTimer);
		button.disabled = false;
		button.hidden = true;
		button.classList.remove("waiting");
	}

	function disableKuji() {
		const button = document.getElementById("kuji");

		if (!button) return;
		clearTimeout(kujiTimer);
		button.disabled = true;
		button.hidden = false;
		button.classList.remove("waiting");
	}

	function exitKuji() {
		kujiNo = undefined;
		hideKuji();
	}

	function lockPage(el = getTitleInput()) {
		document.documentElement.classList.add("capturing");
		if (el) el.readOnly = true;
		getTextareas().forEach((textarea) => {
			textarea.readOnly = true;
		});
	}

	function decodeUrlText(text) {
		try {
			return decodeURIComponent(text.replace(/\+/g, " "));
		} catch (error) {
			console.warn("Unable to decode text from URL.", error);
			return text;
		}
	}

	function encodeBase64(bytes) {
		const chunkSize = 0x8000;
		let binary = "";
		for (let index = 0; index < bytes.length; index += chunkSize) {
			binary += String.fromCharCode(
				...bytes.subarray(index, index + chunkSize),
			);
		}

		return btoa(binary);
	}

	function decodeBase64(base64) {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) {
			bytes[index] = binary.charCodeAt(index);
		}

		return bytes;
	}

	function parseCsv(text) {
		const rows = [];
		let row = [];
		let field = "";
		let inQuotes = false;

		for (let index = 0; index < text.length; index++) {
			const character = text[index];

			if (inQuotes) {
				if (character === '"' && text[index + 1] === '"') {
					field += '"';
					index++;
				} else if (character === '"') {
					inQuotes = false;
				} else {
					field += character;
				}
				continue;
			}

			if (character === '"') {
				inQuotes = true;
			} else if (character === ",") {
				row.push(field);
				field = "";
			} else if (character === "\n") {
				row.push(field);
				if (row.some((value) => value !== "")) rows.push(row);
				row = [];
				field = "";
			} else if (character !== "\r") {
				field += character;
			}
		}

		row.push(field);
		if (row.some((value) => value !== "")) rows.push(row);
		return rows;
	}

	function decodeKujiLines(text) {
		return text.replaceAll("\\n", "\n");
	}

	function getKujiBg(label) {
		const fortune = decodeKujiLines(label).split("\n").at(-1)?.trim();
		switch (fortune) {
			case "大吉":
				return 3;
			case "吉":
				return 2;
			case "半吉":
			case "末吉":
				return 0;
			case "末小吉":
			case "小吉":
				return 1;
			case "凶":
				return 4;
			default:
				return 0;
		}
	}

	async function loadKuji() {
		kujiRows ||= fetch("kuji.csv")
			.then((response) => {
				if (!response.ok) throw new Error(`Unable to load Kujis`);
				return response.text();
			})
			.then((text) => parseCsv(text).filter((row) => row.length >= 2));
		return kujiRows;
	}

	function encodeText(text) {
		return encodeBase64(new TextEncoder().encode(text))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replace(/=+$/, "");
	}

	function decodeText(text) {
		try {
			const normalizedText = text.replace(/=+$/, "");
			const base64 = normalizedText.replaceAll("-", "+").replaceAll("_", "/");
			const padding = "=".repeat((4 - (base64.length % 4)) % 4);
			const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(
				decodeBase64(base64 + padding),
			);
			if (encodeText(decodedText) !== normalizedText) {
				throw new Error("Not a canonical base64url text segment.");
			}

			return decodedText;
		} catch {
			return "";
		}
	}

	function isParam(part, name) {
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
			kujiNumber: undefined,
			segments: [],
			title: "",
		};
		if (!query) return options;

		let collectingText = false;
		for (const part of query.split("&")) {
			if (isParam(part, "edit")) {
				options.canEdit = true;
				continue;
			}

			if (isParam(part, "kuji")) {
				const kujiNumber = Number.parseInt(
					decodeUrlText(part.slice("kuji=".length)),
					10,
				);
				if (kujiNumber >= 1 && kujiNumber <= 100) {
					options.kujiNumber = kujiNumber;
				}
				continue;
			}

			if (isParam(part, "bg")) {
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

			if (isParam(part, "title")) {
				options.hasTitle = true;
				options.title = decodeUrlText(part.slice("title=".length));
				continue;
			}

			if (isParam(part, "text")) {
				options.hasText = true;
				collectingText = true;
				options.segments.push(decodeText(part.slice("text=".length)));
				continue;
			}

			if (collectingText) {
				options.segments.push(decodeText(part));
			}
		}

		options.segments = options.segments.slice(0, MAX_TEXTAREAS);
		return options;
	}

	async function applyUrl() {
		const options = getUrlOptions();
		if (options.kujiNumber) {
			await setKuji(options.kujiNumber);
			if (!options.canEdit) lockPage();
			return options;
		}
		if (!options.hasText && !options.hasTitle && !options.hasBgOption) {
			return options;
		}

		const el = getTitleInput();
		if (el && options.hasTitle) el.value = options.title;

		const select = document.getElementById("background-color");
		if (
			select &&
			options.hasBgOption &&
			options.bgOption >= 0 &&
			options.bgOption < select.options.length
		) {
			select.selectedIndex = options.bgOption;
			setBg(select);
		}

		const textareas = getTextareas();
		const firstTextarea = textareas[0];
		const button = document.getElementById("add");
		if (!firstTextarea || !button) return options;

		if (options.hasText) {
			const segments = options.segments.length ? options.segments : [""];
			firstTextarea.value = segments[0];
			textareas.slice(1).forEach((textarea) => textarea.remove());

			for (const segment of segments.slice(1)) {
				const textarea = textareaTpl
					? textareaTpl.cloneNode(false)
					: document.createElement("textarea");
				textarea.value = segment;
				button.before(textarea);
			}
		}

		if (!options.canEdit) lockPage(el);

		return options;
	}

	function makeShareUrl() {
		const baseUrl = `${window.location.origin}${window.location.pathname}`;
		if (kujiNo) return `${baseUrl}?kuji=${kujiNo}`;

		const segments = getTextareas().map(getTextareaText);
		const title = getTitleInput()?.value || "";
		const bgOption =
			document.getElementById("background-color")?.selectedIndex || 0;
		const params = [];
		if (bgOption > 0) params.push(`bg=${bgOption}`);
		if (title) params.push(`title=${encodeURIComponent(title)}`);
		if (segments.length) {
			params.push(`text=${segments.map(encodeText).join("&")}`);
		}
		return params.length ? `${baseUrl}?${params.join("&")}` : baseUrl;
	}

	function getCodePoints() {
		const codePoints = new Set();
		for (const character of getShotText()) {
			codePoints.add(character.codePointAt(0));
		}
		return codePoints;
	}

	function matchesRange(rangeText, codePoints) {
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

	function encodeBuffer(buffer) {
		return encodeBase64(new Uint8Array(buffer));
	}

	async function loadFontUrl(url) {
		if (!fontCache.has(url)) {
			fontCache.set(
				url,
				fetch(url)
					.then((response) => response.arrayBuffer())
					.then((buffer) => `data:font/woff2;base64,${encodeBuffer(buffer)}`),
			);
		}

		return fontCache.get(url);
	}

	async function embedFont(block, baseUrl) {
		let embeddedBlock = block;
		const urls = [...block.matchAll(/url\((['"]?)([^'")]+\.woff2)\1\)/g)].map(
			(match) => match[2],
		);

		for (const url of urls) {
			const absoluteUrl = new URL(url, baseUrl).href;
			embeddedBlock = embeddedBlock.replaceAll(
				url,
				await loadFontUrl(absoluteUrl),
			);
		}

		return embeddedBlock;
	}

	async function getEmbeddedCss() {
		const stylesheetUrl = getFontSheet();
		if (!stylesheetUrl) return "";

		const codePoints = getCodePoints();
		const cacheKey = [...codePoints].sort((a, b) => a - b).join(",");
		if (cssCache.has(cacheKey)) return cssCache.get(cacheKey);

		try {
			fontCss ||= fetch(stylesheetUrl).then((response) => response.text());
			const cssText = await fontCss;
			const blocks = cssText.match(/@font-face\s*{[\s\S]*?}/g) || [];
			const matchingBlocks = blocks.filter((block) => {
				const range = block.match(/unicode-range:\s*([^;]+);/i)?.[1];
				return matchesRange(range, codePoints);
			});
			const embeddedCss = (
				await Promise.all(
					matchingBlocks.map((block) => embedFont(block, stylesheetUrl)),
				)
			).join("\n");

			cssCache.set(cacheKey, embeddedCss);
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
		copyStyles(textarea, mirror);
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

	function findFontSize(textareas) {
		let low = MIN_FONT_SIZE;
		let high = MAX_FONT_SIZE;

		while (high - low > PRECISION) {
			const mid = (low + high) / 2;
			if (getTextareaMetrics(textareas, mid).allFitWidth) {
				low = mid;
			} else {
				high = mid;
			}
		}

		return Math.max(MIN_FONT_SIZE, low);
	}

	function layoutTextareas(textareas, fontSize) {
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

	function fit() {
		const textareas = getTextareas();
		if (!textareas.length) return;

		const button = document.getElementById("add");
		if (button) {
			button.hidden =
				document.documentElement.classList.contains("capturing") ||
				textareas.length >= MAX_TEXTAREAS;
		}

		textareas.forEach(prepareTextarea);

		const viewportHeight = viewHeight || getViewportHeight();
		let fontSize = findFontSize(textareas);
		layoutTextareas(textareas, fontSize);

		for (let attempts = 0; attempts < 10; attempts++) {
			const pageHeight = document.documentElement.scrollHeight;
			if (pageHeight <= viewportHeight || fontSize <= MIN_FONT_SIZE) break;

			fontSize = Math.max(
				MIN_FONT_SIZE,
				fontSize * (viewportHeight / pageHeight) * 0.98,
			);
			layoutTextareas(textareas, fontSize);
		}

		const el = getTitleInput();
		if (el) el.style.fontSize = `${fontSize}px`;
	}

	function onInput(event) {
		exitKuji();
		const textarea = event.currentTarget;
		if (
			!event.isComposing &&
			!composing.has(textarea) &&
			textarea.value === "" &&
			getTextareas().length > 1
		) {
			textarea.remove();
		}

		fit();
	}

	function onCompositionStart(event) {
		composing.add(event.currentTarget);
	}

	function onCompositionEnd(event) {
		composing.delete(event.currentTarget);
		fit();
	}

	function bindTextarea(textarea) {
		textarea.addEventListener("focus", exitKuji);
		textarea.addEventListener("pointerdown", exitKuji);
		textarea.addEventListener("input", onInput);
		textarea.addEventListener("compositionstart", onCompositionStart);
		textarea.addEventListener("compositionend", onCompositionEnd);
	}

	function addTextarea() {
		if (getTextareas().length >= MAX_TEXTAREAS) return;

		const textarea = textareaTpl
			? textareaTpl.cloneNode(false)
			: document.createElement("textarea");
		textarea.value = "";
		const button = document.getElementById("add");
		button.before(textarea);
		bindTextarea(textarea);
		fit();
		textarea.focus();
		textarea.select();
	}

	function setBg(select) {
		document.documentElement.style.backgroundColor = select.value;
	}

	function parseMs(value) {
		const trimmedValue = value.trim();
		if (trimmedValue.endsWith("ms")) return px(trimmedValue);
		if (trimmedValue.endsWith("s")) return px(trimmedValue) * 1000;
		return px(trimmedValue) * 1000;
	}

	function getMaxTransition(element) {
		const styles = window.getComputedStyle(element);
		const durations = styles.transitionDuration.split(",").map(parseMs);
		const delays = styles.transitionDelay.split(",").map(parseMs);
		return Math.max(
			0,
			...durations.map((duration, index) => duration + (delays[index] || 0)),
		);
	}

	function waitForBg(action) {
		const transitionTime = getMaxTransition(document.documentElement);

		return new Promise((resolve) => {
			let timer;
			const finish = () => {
				clearTimeout(timer);
				document.documentElement.removeEventListener(
					"transitionend",
					handleTransitionEnd,
				);
				resolve();
			};
			const handleTransitionEnd = (event) => {
				if (event.propertyName === "background-color") finish();
			};

			document.documentElement.addEventListener(
				"transitionend",
				handleTransitionEnd,
			);
			action();
			timer = setTimeout(finish, transitionTime + 50);
		});
	}

	function ensureTextareas(count) {
		let textareas = getTextareas();
		while (textareas.length > count) {
			textareas.pop().remove();
		}
		while (textareas.length < count) {
			const textarea = textareaTpl
				? textareaTpl.cloneNode(false)
				: document.createElement("textarea");
			textarea.value = "";
			const button = document.getElementById("add");
			button.before(textarea);
			bindTextarea(textarea);
			textareas.push(textarea);
		}
		return textareas;
	}

	async function setKuji(number, shouldWaitForBg = false) {
		const rows = await loadKuji();
		const row = rows[number - 1];
		if (!row) return false;

		kujiNo = number;
		const [label, poem] = row;
		const textareas = ensureTextareas(2);
		const el = getTitleInput();
		if (el) el.value = "";
		textareas[0].value = `\n${decodeKujiLines(label)}`;
		textareas[1].value = decodeKujiLines(poem);

		const select = document.getElementById("background-color");
		if (select) {
			select.selectedIndex = getKujiBg(label);
			if (shouldWaitForBg) {
				await waitForBg(() => setBg(select));
			} else {
				setBg(select);
			}
		}

		fit();
		return true;
	}

	async function drawKuji() {
		try {
			const rows = await loadKuji();
			if (!rows.length) return false;

			const number = Math.floor(Math.random() * rows.length) + 1;
			return setKuji(number, true);
		} catch (error) {
			console.warn("Unable to draw kuji.", error);
			return false;
		}
	}

	function showPreview(dataUrl) {
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

		const shareUrl = makeShareUrl();
		link.href = dataUrl;
		image.src = dataUrl;
		shareInput.hidden = shareUrl.length > MAX_URL;
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

	async function saveImage() {
		if (!window.htmlToImage) return;
		const saveButton = document.getElementById("save");
		const initialText = saveButton.textContent;

		saveButton.textContent = "待";
		saveButton.disabled = true;
		await document.fonts?.ready;
		const fontEmbedCSS = await getEmbeddedCss();
		const rootStyles = getComputedStyle(document.documentElement);
		const addButton = document.getElementById("add");
		const paddingX = px(rootStyles.paddingLeft) + px(rootStyles.paddingRight);
		const fullWidth = document.documentElement.scrollWidth;
		const width = Math.min(fullWidth, px(rootStyles.width) + paddingX);
		const height = Math.max(
			0,
			document.documentElement.scrollHeight - (addButton.hidden ? 0 : 32),
		);
		document.documentElement.classList.add("capturing");

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
			showPreview(croppedCanvas.toDataURL("image/png"));
		} finally {
			saveButton.textContent = initialText;
			saveButton.disabled = false;
			document.documentElement.classList.remove("capturing");
		}
	}

	document.addEventListener("DOMContentLoaded", async () => {
		viewHeight = getViewportHeight();
		textareaTpl = document.querySelector("textarea")?.cloneNode(false);
		if (textareaTpl) {
			textareaTpl.value = "";
		}

		const options = await applyUrl();
		getTextareas().forEach(bindTextarea);
		const titleInput = getTitleInput();
		titleInput?.addEventListener("focus", exitKuji);
		titleInput?.addEventListener("pointerdown", exitKuji);
		titleInput?.addEventListener("input", exitKuji);
		document
			.getElementById("background-color")
			?.addEventListener("change", (event) => {
				setBg(event.currentTarget);
			});
		document.getElementById("save")?.addEventListener("click", () => {
			if (!kujiNo) hideKuji();
			saveImage();
		});
		document.getElementById("add")?.addEventListener("click", () => {
			exitKuji();
			addTextarea();
		});
		const kujiButton = document.getElementById("kuji");
		if (kujiButton) {
			if (options.hasText && !options.kujiNumber) {
				hideKuji();
			} else if (options.kujiNumber) {
				showKuji(kujiButton, { transition: false });
			} else {
				showKuji(kujiButton);
			}
			kujiButton.addEventListener("click", async () => {
				if (await drawKuji()) {
					await saveImage();
					disableKuji();
				}
			});
		}
		window.addEventListener("resize", fit);
		document.fonts?.ready.then(fit);
		fit();
	});
})();
