(() => {
	const MIN_FONT_SIZE = 8;
	const MAX_FONT_SIZE = 32;
	const MAX_TEXTAREAS = 5;
	const FIT_PRECISION = 0.1;
	const WRAP_BUFFER = 2;
	let textareaTemplate;

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
			"lineHeight",
			"textTransform",
			"textIndent",
			"textOrientation",
			"writingMode",
			"wordSpacing",
		]) {
			to.style[property] = styles[property];
		}
		to.style.padding = styles.padding;
		to.style.border = styles.border;
		to.style.boxSizing = styles.boxSizing;
	}

	function getMirror() {
		let mirror = document.getElementById("textarea-fit-mirror");
		if (mirror) return mirror;

		mirror = document.createElement("div");
		mirror.id = "textarea-fit-mirror";
		mirror.setAttribute("aria-hidden", "true");
		Object.assign(mirror.style, {
			position: "absolute",
			left: "-10000px",
			top: "0",
			visibility: "hidden",
			whiteSpace: "pre",
			overflow: "visible",
			resize: "none",
		});
		document.body.appendChild(mirror);
		return mirror;
	}

	function getTextareas() {
		return [...document.querySelectorAll("textarea")];
	}

	function getTextareaText(textarea) {
		return textarea.value || textarea.placeholder || " ";
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
		mirror.style.paddingBlockStart = "0px";
		mirror.style.paddingBlockEnd = "0px";
		mirror.style.whiteSpace = "pre";
		mirror.textContent = getTextareaText(textarea);

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
				(textarea.getBoundingClientRect().width || textarea.clientWidth) - borderX;
			const fitWidth = Math.max(0, targetWidth - WRAP_BUFFER);
			const size = measure(textarea, fontSize);

			minTargetWidth = Math.min(minTargetWidth, targetWidth);
			maxTextWidth = Math.max(maxTextWidth, size.width);
			maxHeight = Math.max(maxHeight, Math.ceil(size.height + borderY));
			allFitWidth &&= size.width <= fitWidth;
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

		const button = document.querySelector("button");
		if (button) button.hidden = textareas.length >= MAX_TEXTAREAS;

		textareas.forEach(prepareTextarea);

		const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
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
	}

	function handleTextareaInput(event) {
		const textarea = event.currentTarget;
		if (textarea.value === "" && getTextareas().length > 1) {
			textarea.remove();
		}

		fitAllTextareas();
	}

	function bindTextarea(textarea) {
		textarea.addEventListener("input", handleTextareaInput);
	}

	function createTextarea() {
		if (getTextareas().length >= MAX_TEXTAREAS) return;

		const textarea = textareaTemplate
			? textareaTemplate.cloneNode(false)
			: document.createElement("textarea");
		textarea.value = "";
		textarea.textContent = "";
		const button = document.querySelector("button");
		button.before(textarea);
		bindTextarea(textarea);
		fitAllTextareas();
		textarea.focus();
		textarea.select();
	}

	document.addEventListener("DOMContentLoaded", () => {
		textareaTemplate = document.querySelector("textarea")?.cloneNode(false);
		if (textareaTemplate) {
			textareaTemplate.value = "";
			textareaTemplate.textContent = "";
		}

		getTextareas().forEach(bindTextarea);
		document.querySelector("button")?.addEventListener("click", createTextarea);
		window.addEventListener("resize", fitAllTextareas);
		document.fonts?.ready.then(fitAllTextareas);
		fitAllTextareas();
	});
})();
