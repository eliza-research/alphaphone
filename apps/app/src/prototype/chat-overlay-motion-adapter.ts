import {
	clamp01,
	OVERLAY_EASE,
} from "../../../../.eliza/client-features/packages/ui/src/components/shell/chat-overlay-motion.ts";
import { resolveChatPanelLayout } from "../../../../.eliza/client-features/packages/ui/src/components/shell/chat-panel-layout.ts";
import { TAP_SLOP } from "../../../../.eliza/client-features/packages/ui/src/gestures/constants";
import { visibleDocks } from "../runtime/dock-clearance";

const PANEL_TRANSITION = `height .42s cubic-bezier(${OVERLAY_EASE.join(",")}), border-radius .42s, opacity .2s`;
type Shell = any;
type Mode = "hidden" | "input" | "sheet" | "full";
type Drag = {
	id: number;
	owner: HTMLElement;
	mode: Mode;
	view: unknown;
	screen: unknown;
	offset: number;
	y: number;
	scale: number;
	start: number;
	height: number;
	full: number;
	half: number;
	moved: boolean;
	tap?: () => void;
};
/** The nearest ancestor that scrolls vertically and has somewhere to scroll to. */
function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if (
			(overflow === "auto" || overflow === "scroll") &&
			node.scrollHeight > node.clientHeight
		)
			return node;
	}
	return null;
}
/** Product gesture binding over shared pure geometry; never owns transcript or editable-control gestures. */
export function installChatOverlayMotion(Component: Shell) {
	const p = Component.prototype,
		render = p.renderVals,
		mount = p.componentDidMount,
		update = p.componentDidUpdate,
		unmount = p.componentWillUnmount;
	function bounds() {
		const screen = document.querySelector<HTMLElement>("[data-screen]");
		const viewportH = screen?.clientHeight || window.innerHeight;
		// Shared layout supplies the viewport ceiling; retain its 200px short-panel preference.
		const full = resolveChatPanelLayout({
			viewportH,
			bottomPad: 0,
			keyboardInset: 0,
			effectiveKeyboardInset: 0,
			safeAreaTopPx: 0,
			fullBleed: true,
		}).panelMaxH;
		const inset = resolveChatPanelLayout({
			viewportH,
			bottomPad: 0,
			keyboardInset: 0,
			effectiveKeyboardInset: 0,
			safeAreaTopPx: 0,
			fullBleed: false,
		}).panelMaxH;
		return {
			full,
			half: Math.min(inset, Math.max(200, Math.round(viewportH * 0.6))),
			scale: screen ? screen.getBoundingClientRect().height / viewportH : 1,
		};
	}
	function retire(shell: Shell, redraw = true) {
		const drag: Drag | undefined = shell.chatMotion;
		shell.chatMotion = undefined;
		if (!drag) return;
		if (drag.moved) {
			shell.chatDraggedAt = Date.now();
			shell.swallow = Date.now();
			// Cancellation can precede React's first preview commit; restore direct
			// paints explicitly instead of relying on an unchanged virtual style diff.
			const panel = document.querySelector<HTMLElement>(
					'[data-alpha-layer="conversation"]',
				),
				geometry = bounds(),
				mode = shell.S().chat;
			if (panel) {
				panel.style.height = `${mode === "full" ? geometry.full : mode === "sheet" ? geometry.half : 0}px`;
				panel.style.transition = PANEL_TRANSITION;
			}
			const input = document.querySelector<HTMLElement>(
				"[data-alpha-input-bar]",
			);
			if (input)
				for (const name of ["transform", "opacity", "transition", "animation"])
					input.style.removeProperty(name);
			document
				.querySelector<HTMLElement>('[data-alpha-layer="pill"]>div')
				?.style.removeProperty("opacity");
		}
		if (drag.owner.hasPointerCapture(drag.id))
			drag.owner.releasePointerCapture(drag.id);
		if (redraw && shell.live !== false) shell.setState({});
	}
	p.componentDidMount = function () {
		mount?.call(this);
		this.cancelChatMotion = () => retire(this);
		this.chatMotionVisibility = () => {
			if (document.hidden) retire(this);
		};
		window.addEventListener("resize", this.cancelChatMotion);
		window.addEventListener("blur", this.cancelChatMotion);
		window.addEventListener("pagehide", this.cancelChatMotion);
		document.addEventListener("visibilitychange", this.chatMotionVisibility);
	};
	p.componentDidUpdate = function (...args: Shell[]) {
		update?.apply(this, args);
		const drag: Drag | undefined = this.chatMotion,
			s = this.S();
		if (
			drag &&
			(s.view !== drag.view ||
				s.screen !== drag.screen ||
				s.chat !== drag.mode ||
				s.voice !== "off")
		)
			retire(this);
	};
	p.componentWillUnmount = function () {
		retire(this, false);
		window.removeEventListener("resize", this.cancelChatMotion);
		window.removeEventListener("blur", this.cancelChatMotion);
		window.removeEventListener("pagehide", this.cancelChatMotion);
		document.removeEventListener("visibilitychange", this.chatMotionVisibility);
		unmount?.call(this);
	};

	p.tapChatMotion = function () {
		const d: Drag | undefined = this.chatMotion;
		if (!d) return;
		const action = d.tap;
		retire(this, false);
		if (action) {
			action();
			this.swallow = Date.now();
		} else this.setState({});
	};
	p.paintChatMotion = function (offset: number) {
		const d: Drag | undefined = this.chatMotion;
		if (!d || this.live === false || document.hidden) return;
		const shell = this,
			delta = -offset / d.scale;
		if (!d.moved && Math.abs(delta) < TAP_SLOP) return;
		const firstMove = !d.moved;
		d.moved = true;
		d.offset = offset;
		d.height =
			d.mode === "input" && delta > 0
				? 0
				: clamp01((d.start - delta) / Math.max(1, d.full)) * d.full;
		// The shared hook coalesces these direct paints once per frame; rebuilding the app
		// per movement would put React work between the finger and the sheet.
		const panel = document.querySelector<HTMLElement>(
			'[data-alpha-layer="conversation"]',
		);
		if (panel) {
			panel.style.transition = "none";
			panel.style.height = `${d.height}px`;
		}
		const pill = document.querySelector<HTMLElement>(
			'[data-alpha-layer="pill"]>div',
		);
		if (pill)
			pill.style.opacity = String(1 - clamp01(d.height / Math.max(1, d.half)));
		if (d.mode === "input") {
			const input = document.querySelector<HTMLElement>(
				"[data-alpha-input-bar]",
			);
			if (input) {
				input.style.transform = `translateY(${delta}px)`;
				input.style.opacity = String(
					1 - clamp01(Math.abs(delta) / Math.max(80, d.half)),
				);
				input.style.transition = "none";
				input.style.animation = "none";
			}
		}
		if (firstMove) shell.setState({});
	};
	p.settleChatMotion = function (direction: "up" | "down") {
		const d: Drag | undefined = this.chatMotion;
		if (!d) return;
		if (Math.abs(d.offset / d.scale) < TAP_SLOP) {
			retire(this);
			return;
		}
		const next =
			direction === "up"
				? d.mode === "sheet" || d.height > (d.half + d.full) / 2
					? "full"
					: "sheet"
				: d.mode === "full" &&
						d.height > d.half / 2 &&
						-d.offset / d.scale <= d.half
					? "sheet"
					: "hidden";
		retire(this, false);
		this.swallow = Date.now();
		this.setState({ chat: next });
	};
	p.renderVals = function () {
		const out = render.call(this),
			shell = this,
			s = this.S(),
			geometry = bounds(),
			drag: Drag | undefined = this.chatMotion;
		out.panelH =
			drag?.height ??
			(s.chat === "full"
				? geometry.full
				: s.chat === "sheet"
					? geometry.half
					: 0);
		out.panelTransition = drag?.moved ? "none" : PANEL_TRANSITION;
		// As in OG's scroll clearance, reserve the resting sheet's footprint and
		// reveal focused app controls without changing the sheet or focus owner.
		// The same holds for the floating dock (composer bar or pill): a control
		// that takes focus while part of it is under the dock is scrolled wholly
		// above it, so keyboard and switch focus is never left half covered.
		out.focusAppContent = (event: FocusEvent) => {
			const target = event.target;
			if (
				!(target instanceof HTMLElement) ||
				target.closest('[inert],[role="dialog"]') ||
				document.querySelector("dialog[open]")
			)
				return;
			const scroll = target.closest<HTMLElement>(
				'[data-alpha-app-scroll],[data-installed-apps-scroll],[data-alpha-layer="home"],.calendar-timeline,.calendar-draft-fields',
			) ?? scrollParent(target);
			if (!scroll || target === scroll) return;
			const box = target.getBoundingClientRect();
			const sheet = shell.S().chat === "sheet";
			// Under the dock only focus that did not come from a pointer is moved:
			// scrolling a pressed control out from under the finger would lose the tap.
			if (!sheet && !target.matches(":focus-visible")) return;
			const covers =
				sheet
					? Array.from(
							document.querySelectorAll<HTMLElement>(
								'[data-alpha-layer="conversation"]',
							),
						)
					: visibleDocks();
			let hidden = 0;
			for (const cover of covers) {
				const over = cover.getBoundingClientRect();
				// A dock beside the page (landscape) covers nothing of it.
				if (over.right <= box.left || over.left >= box.right) continue;
				hidden = Math.max(hidden, box.bottom - over.top + 12);
			}
			if (hidden > 0) scroll.scrollTop += hidden / geometry.scale;
		};
		out.pillDragStyle = drag?.moved
			? `opacity:${1 - clamp01(drag.height / Math.max(1, drag.half))}`
			: "";
		out.inputDragStyle =
			drag?.mode === "input" && drag.moved
				? `transform:translateY(${-drag.offset / drag.scale}px);opacity:${1 - clamp01(Math.abs(drag.offset / drag.scale) / Math.max(80, drag.half))};transition:none;animation:none`
				: "";
		if (drag?.moved && (drag.mode !== "input" || drag.height > 0)) {
			out.conversationHidden = false;
			out.panelComposer = true;
			out.panelOp = 1;
			out.panelPE = "auto";
			out.panelR = drag.height >= drag.full ? "0px" : "30px 30px 0 0";
		}
		const binding = shell.props.chatPullBinding;
		const handlers = {
			down(event: PointerEvent) {
				if (
					shell.chatMotion ||
					event.isPrimary === false ||
					event.button !== 0 ||
					!["hidden", "input", "sheet", "full"].includes(shell.S().chat)
				)
					return;
				// Empty placeholder text is also a handle. Authored text, Send and Talk
				// retain their native editing and activation behavior.
				const emptyInput =
					event.target instanceof HTMLTextAreaElement &&
					event.target.value.length === 0 &&
					String(out.draft || "").length === 0;
				if (
					shell.S().chat === "input" &&
					!emptyInput &&
					(!(event.target instanceof Element) ||
						!event.target.closest(
							"[data-alpha-input-drag-background],[data-alpha-input-drag-alpha]",
						))
				)
					return;
				if (
					!binding ||
					document.hidden ||
					shell.live === false ||
					shell.S().voice !== "off"
				)
					return;
				event.stopPropagation();
				if (emptyInput) event.preventDefault();
				const g = bounds(),
					mode = shell.S().chat as Mode,
					owner = event.currentTarget as HTMLElement,
					label = (event.target as Element)
						?.closest("button")
						?.getAttribute("aria-label"),
					tap = emptyInput
						? () => owner.focus()
						: label === "Open conversation"
							? out.openSheet
							: label === "Type"
								? out.toInput
								: label === "Talk"
									? out.startVoice
									: label === "Resize chat"
										? () => out.grabTap({ detail: 1 })
										: undefined;
				shell.swallow = 0;
				shell.chatMotion = {
					id: event.pointerId,
					owner,
					mode,
					view: shell.S().view,
					screen: shell.S().screen,
					offset: 0,
					y: event.clientY,
					scale: g.scale || 1,
					start:
						mode === "full"
							? g.full
							: mode === "sheet"
								? g.half
								: Math.min(
										mode === "input"
											? (document.querySelector<HTMLElement>(
													"[data-alpha-input-bar]",
												)?.clientHeight || 62) + 28
											: 80,
										g.half,
									),
					height: mode === "full" ? g.full : mode === "sheet" ? g.half : 0,
					full: g.full,
					half: g.half,
					moved: false,
					tap,
				} satisfies Drag;
				shell.props.configureChatPull({
					input: mode === "input",
					scale: g.scale || 1,
				});
				binding.onPointerDown(event);
			},
			move(event: PointerEvent) {
				if (shell.chatMotion?.id !== event.pointerId) return;
				event.stopPropagation();
				binding.onPointerMove(event);
			},
			up(event: PointerEvent) {
				if (shell.chatMotion?.id !== event.pointerId) return;
				event.stopPropagation();
				// A browser can coalesce every move into release. Supply the product's
				// final paint; the shared hook still owns release intent and settlement.
				const d: Drag = shell.chatMotion;
				if (!d.moved) shell.paintChatMotion(d.y - event.clientY);
				binding.onPointerUp(event);
			},
			cancel(event: PointerEvent) {
				binding?.onPointerCancel(event);
			},
			lost(event: PointerEvent) {
				binding?.onLostPointerCapture(event);
			},
		};
		out.grabSw = handlers;
		out.pillSw = handlers;
		out.inputSw = handlers;
		out.inputComposerTouchAction =
			String(out.draft || "").length === 0 ? "none" : "pan-y";
		out.inputComposerPointer = (event: PointerEvent) => {
			if (
				event.target instanceof HTMLTextAreaElement &&
				event.target.value.length === 0 &&
				String(out.draft || "").length === 0
			)
				handlers.down(event);
			else out.composerPointer(event);
		};
		// A captured drag may end over a former pill button. It must not synthesize
		// a second action (including Type/Talk) after committing its detent.
		for (const name of ["openSheet", "toInput", "startVoice"]) {
			const action = out[name];
			out[name] = (...args: unknown[]) => {
				if (!shell.swallowed()) return action?.(...args);
			};
		}
		const grabTap = out.grabTap;
		out.grabTap = (event: MouseEvent) => {
			// A new toolbar tap must not be swallowed by the preceding Open tap.
			// Retain suppression for a compatibility click produced by a real drag.
			const toolbar=event.currentTarget instanceof HTMLElement&&event.currentTarget.hasAttribute('data-alpha-chat-size');
			if (event.detail === 0 || toolbar&&Date.now()-(shell.chatDraggedAt||0)>350) {
				retire(shell, false);
				shell.setState({ chat: shell.S().chat === "full" ? "sheet" : "full" });
			} else grabTap(event);
		};
		out.closeChat = () => {
			retire(shell, false);
			shell.setState({ chat: "hidden" });
		};
		out.scrimTap = out.closeChat;
		return out;
	};
}
