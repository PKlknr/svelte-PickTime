(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(global = global || self, global.PickTime = factory());
}(this, (function () { 'use strict';

	function noop() {}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function null_to_empty(value) {
		return value == null ? '' : value;
	}

	let is_hydrating = false;

	function update_hydrating(val) {
		is_hydrating = val;
	}

	function append(target, node) {
		if (!is_hydrating || node.parentNode !== target) {
			target.appendChild(node);
		}
	}

	function insert(target, node, anchor) {
		if (!is_hydrating || node.parentNode !== target) {
			target.insertBefore(node, anchor || null);
		}
	}

	function detach(node) {
		node.parentNode.removeChild(node);
	}

	function destroy_each(iterations, detaching) {
		for (let i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detaching);
		}
	}

	function element(name) {
		return document.createElement(name);
	}

	function svg_element(name) {
		return document.createElementNS('http://www.w3.org/2000/svg', name);
	}

	function text(data) {
		return document.createTextNode(data);
	}

	function space() {
		return text(' ');
	}

	function empty() {
		return text('');
	}

	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function prevent_default(fn) {
		return function(event) {
			event.preventDefault();
			// @ts-ignore
			return fn.call(this, event);
		};
	}

	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
	}

	function children(element) {
		const children = Array.from(element.childNodes);
		return {
			children,
			element,
			next: children[0] || null,
			last: children.length ? children[children.length - 1].nextSibling : null,
		};
	}

	function claim_element(nodes, name, fallback, svg) {
		for (let i = 0; i < nodes.children.length; i += 1) {
			const node = nodes.children[i];
			if (node.nodeType !== 3) {
				if (node.nodeName === name) {
					nodes.children.splice(0,i + 1);
					nodes.next = nodes.children[0];
					return node;
				} else {
					nodes.next = nodes.last;
					nodes.children.forEach(detach);
					nodes.children.length = 0;
					break;
				}
			}
		}
		const node = fallback || (svg ? svg_element(name) : element(name));
		insert(nodes.element, node, nodes.next);
		return node;
	}

	function claim_text(nodes, data) {
		if (nodes.children.length && nodes.children[0].nodeType === 3) {
			const node = nodes.children.shift();
			node.data = '' + data;
			nodes.next = nodes.children[0];
			return node;
		} else {
			const node = text(data);
			insert(nodes.element, node, nodes.next);
			return node;
		}
	}

	function claim_space(nodes) {
		return claim_text(nodes, ' ');
	}

	function set_data(text, data) {
		data = '' + data;
		if (text.data !== data) text.data = data;
	}

	function toggle_class(element, name, toggle) {
		element.classList[toggle ? 'add' : 'remove'](name);
	}

	function custom_event(type, detail) {
		const e = document.createEvent('CustomEvent');
		e.initCustomEvent(type, false, false, detail);
		return e;
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function createEventDispatcher() {
		const component = get_current_component();

		return (type, detail) => {
			const callbacks = component.$$.callbacks[type];

			if (callbacks) {
				// TODO are there situations where events could be dispatched
				// in a server (non-DOM) environment?
				const event = custom_event(type, detail);
				callbacks.slice().forEach(fn => {
					fn.call(component, event);
				});
			}
		};
	}

	const dirty_components = [];

	const binding_callbacks = [];
	const render_callbacks = [];
	const flush_callbacks = [];

	const resolved_promise = Promise.resolve();
	let update_scheduled = false;

	function schedule_update() {
		if (!update_scheduled) {
			update_scheduled = true;
			resolved_promise.then(flush);
		}
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	const seen_callbacks = new Set();
	function flush() {

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.pop()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			for (let i = 0; i < render_callbacks.length; i += 1) {
				const callback = render_callbacks[i];

				if (!seen_callbacks.has(callback)) {
					// ...so guard against infinite loops
					seen_callbacks.add(callback);

					callback();
				}
			}

			render_callbacks.length = 0;
		} while (dirty_components.length);

		while (flush_callbacks.length) {
			flush_callbacks.pop()();
		}

		update_scheduled = false;
		seen_callbacks.clear();
	}

	function update($$) {
		if ($$.fragment !== null) {
			$$.update();
			run_all($$.before_update);
			const dirty = $$.dirty;
			$$.dirty = [-1];
			$$.fragment && $$.fragment.p($$.ctx, dirty);

			$$.after_update.forEach(add_render_callback);
		}
	}

	const outroing = new Set();
	let outros;

	function group_outros() {
		outros = {
			r: 0,     // remaining outros
			c: [],    // callbacks
			p: outros // parent group
		};
	}

	function check_outros() {
		if (!outros.r) {
			run_all(outros.c);
		}
		outros = outros.p;
	}

	function transition_in(block, local) {
		if (block && block.i) {
			outroing.delete(block);
			block.i(local);
		}
	}

	function transition_out(block, local, detach, callback) {
		if (block && block.o) {
			if (outroing.has(block)) return;
			outroing.add(block);

			outros.c.push(() => {
				outroing.delete(block);
				if (callback) {
					if (detach) block.d(1);
					callback();
				}
			});

			block.o(local);
		}
	}

	function create_component(block) {
		block && block.c();
	}

	function claim_component(block, parent_nodes) {
		block && block.l(parent_nodes);
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_update } = component.$$;

		fragment && fragment.m(target, anchor);

		// onMount happens before the initial afterUpdate
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_update.forEach(add_render_callback);
	}

	function destroy_component(component, detaching) {
		const $$ = component.$$;
		if ($$.fragment !== null) {
			run_all($$.on_destroy);

			$$.fragment && $$.fragment.d(detaching);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			$$.on_destroy = $$.fragment = null;
			$$.ctx = [];
		}
	}

	function make_dirty(component, i) {
		if (component.$$.dirty[0] === -1) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty.fill(0);
		}
		component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
	}

	function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
		const parent_component = current_component;
		set_current_component(component);

		const prop_values = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			props,
			update: noop,
			not_equal,
			bound: blank_object(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_update: [],
			after_update: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blank_object(),
			dirty
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, prop_values, (i, ret, ...rest) => {
				const value = rest.length ? rest[0] : ret;
				if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
					if ($$.bound[i]) $$.bound[i](value);
					if (ready) make_dirty(component, i);
				}
				return ret;
			})
			: [];

		$$.update();
		ready = true;
		run_all($$.before_update);

		// `false` as a special case of no DOM component
		$$.fragment = create_fragment ? create_fragment($$.ctx) : false;

		if (options.target) {
			if (options.hydrate) {
				update_hydrating(true);
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				$$.fragment && $$.fragment.l(children(options.target));
			} else {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				$$.fragment && $$.fragment.c();
			}

			if (options.intro) transition_in(component.$$.fragment);
			mount_component(component, options.target, options.anchor);
			update_hydrating(false);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		

		$destroy() {
			destroy_component(this, 1);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	const markerIndex2Rad =
	  (markerIndex, div) => (-markerIndex) / (div / 2) * Math.PI + Math.PI;

	const sico = fn =>
	  (markerIndex, r, div = 12) => r * fn(markerIndex2Rad(markerIndex, div));

	const cx = sico(Math.sin);
	const cy = sico(Math.cos);

	/* src/PickTime/Hand.svelte generated by Svelte v3.18.1 */

	function add_css() {
		var style = element("style");
		style.id = "svelte-281db0-style";
		style.textContent = "line.svelte-281db0{stroke:var(--timepick-hand-active-color, #63b3ed);stroke-width:0.5;transition-property:all;transition-duration:0.24s}.betweenDiv.svelte-281db0{stroke:white}circle.active.svelte-281db0{fill:var(--timepick-hand-active-color, #63b3ed)}circle.hover.svelte-281db0{fill:var(--timepick-hand-hover-color, #e2e8f0)}line.hover.svelte-281db0{stroke:var(--timepick-hand-hover-color, #e2e8f0)}";
		append(document.head, style);
	}

	// (50:0) {#if betweenDiv}
	function create_if_block(ctx) {
		let line;
		let line_x__value;
		let line_y__value;
		let line_x__value_1;
		let line_y__value_1;

		return {
			c() {
				line = svg_element("line");
				this.h();
			},
			l(nodes) {
				line = claim_element(nodes, "line", null, 1);
				children(line).children.forEach(detach);
				this.h();
			},
			h() {
				attr(line, "class", "betweenDiv svelte-281db0");
				attr(line, "x1", line_x__value = cx(/*i*/ ctx[1], /*length*/ ctx[3] - 3, /*div*/ ctx[2]));
				attr(line, "y1", line_y__value = cy(/*i*/ ctx[1], /*length*/ ctx[3] - 3, /*div*/ ctx[2]));
				attr(line, "x2", line_x__value_1 = cx(/*i*/ ctx[1], /*length*/ ctx[3] + 3, /*div*/ ctx[2]));
				attr(line, "y2", line_y__value_1 = cy(/*i*/ ctx[1], /*length*/ ctx[3] + 3, /*div*/ ctx[2]));
			},
			m(target, anchor) {
				insert(target, line, anchor);
			},
			p(ctx, dirty) {
				if (dirty & /*i, length, div*/ 14 && line_x__value !== (line_x__value = cx(/*i*/ ctx[1], /*length*/ ctx[3] - 3, /*div*/ ctx[2]))) {
					attr(line, "x1", line_x__value);
				}

				if (dirty & /*i, length, div*/ 14 && line_y__value !== (line_y__value = cy(/*i*/ ctx[1], /*length*/ ctx[3] - 3, /*div*/ ctx[2]))) {
					attr(line, "y1", line_y__value);
				}

				if (dirty & /*i, length, div*/ 14 && line_x__value_1 !== (line_x__value_1 = cx(/*i*/ ctx[1], /*length*/ ctx[3] + 3, /*div*/ ctx[2]))) {
					attr(line, "x2", line_x__value_1);
				}

				if (dirty & /*i, length, div*/ 14 && line_y__value_1 !== (line_y__value_1 = cy(/*i*/ ctx[1], /*length*/ ctx[3] + 3, /*div*/ ctx[2]))) {
					attr(line, "y2", line_y__value_1);
				}
			},
			d(detaching) {
				if (detaching) detach(line);
			}
		};
	}

	function create_fragment(ctx) {
		let line;
		let line_class_value;
		let line_x__value;
		let line_y__value;
		let line_x__value_1;
		let line_y__value_1;
		let t0;
		let circle;
		let circle_class_value;
		let circle_cx_value;
		let circle_cy_value;
		let t1;
		let if_block_anchor;
		let if_block = /*betweenDiv*/ ctx[5] && create_if_block(ctx);

		return {
			c() {
				line = svg_element("line");
				t0 = space();
				circle = svg_element("circle");
				t1 = space();
				if (if_block) if_block.c();
				if_block_anchor = empty();
				this.h();
			},
			l(nodes) {
				line = claim_element(nodes, "line", null, 1);
				children(line).children.forEach(detach);
				t0 = claim_space(nodes);
				circle = claim_element(nodes, "circle", null, 1);
				children(circle).children.forEach(detach);
				t1 = claim_space(nodes);
				if (if_block) if_block.l(nodes);
				if_block_anchor = claim_text(nodes, ""); /*IF242*/
				this.h();
			},
			h() {
				attr(line, "class", line_class_value = "" + (null_to_empty(/*className*/ ctx[0]) + " svelte-281db0"));
				attr(line, "x1", line_x__value = 0);
				attr(line, "y1", line_y__value = 0);
				attr(line, "x2", line_x__value_1 = cx(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]));
				attr(line, "y2", line_y__value_1 = cy(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]));
				attr(circle, "class", circle_class_value = "active " + /*className*/ ctx[0] + " svelte-281db0");
				attr(circle, "cx", circle_cx_value = cx(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]));
				attr(circle, "cy", circle_cy_value = cy(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]));
				attr(circle, "r", /*r*/ ctx[4]);
			},
			m(target, anchor) {
				insert(target, line, anchor);
				insert(target, t0, anchor);
				insert(target, circle, anchor);
				insert(target, t1, anchor);
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},
			p(ctx, [dirty]) {
				if (dirty & /*className*/ 1 && line_class_value !== (line_class_value = "" + (null_to_empty(/*className*/ ctx[0]) + " svelte-281db0"))) {
					attr(line, "class", line_class_value);
				}

				if (dirty & /*i, length, div*/ 14 && line_x__value_1 !== (line_x__value_1 = cx(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]))) {
					attr(line, "x2", line_x__value_1);
				}

				if (dirty & /*i, length, div*/ 14 && line_y__value_1 !== (line_y__value_1 = cy(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]))) {
					attr(line, "y2", line_y__value_1);
				}

				if (dirty & /*className*/ 1 && circle_class_value !== (circle_class_value = "active " + /*className*/ ctx[0] + " svelte-281db0")) {
					attr(circle, "class", circle_class_value);
				}

				if (dirty & /*i, length, div*/ 14 && circle_cx_value !== (circle_cx_value = cx(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]))) {
					attr(circle, "cx", circle_cx_value);
				}

				if (dirty & /*i, length, div*/ 14 && circle_cy_value !== (circle_cy_value = cy(/*i*/ ctx[1], /*length*/ ctx[3], /*div*/ ctx[2]))) {
					attr(circle, "cy", circle_cy_value);
				}

				if (dirty & /*r*/ 16) {
					attr(circle, "r", /*r*/ ctx[4]);
				}

				if (/*betweenDiv*/ ctx[5]) {
					if (if_block) {
						if_block.p(ctx, dirty);
					} else {
						if_block = create_if_block(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},
			i: noop,
			o: noop,
			d(detaching) {
				if (detaching) detach(line);
				if (detaching) detach(t0);
				if (detaching) detach(circle);
				if (detaching) detach(t1);
				if (if_block) if_block.d(detaching);
				if (detaching) detach(if_block_anchor);
			}
		};
	}

	function instance($$self, $$props, $$invalidate) {
		let { class: className = "" } = $$props;
		let { i } = $$props;
		let { div } = $$props;
		let { length } = $$props;
		let { r } = $$props;
		let { step = 0 } = $$props;
		let betweenDiv;

		$$self.$set = $$props => {
			if ("class" in $$props) $$invalidate(0, className = $$props.class);
			if ("i" in $$props) $$invalidate(1, i = $$props.i);
			if ("div" in $$props) $$invalidate(2, div = $$props.div);
			if ("length" in $$props) $$invalidate(3, length = $$props.length);
			if ("r" in $$props) $$invalidate(4, r = $$props.r);
			if ("step" in $$props) $$invalidate(6, step = $$props.step);
		};

		$$self.$$.update = () => {
			if ($$self.$$.dirty & /*step, i*/ 66) {
				 $$invalidate(5, betweenDiv = step && i % step !== 0);
			}
		};

		return [className, i, div, length, r, betweenDiv, step];
	}

	class Hand extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-281db0-style")) add_css();

			init(this, options, instance, create_fragment, safe_not_equal, {
				class: 0,
				i: 1,
				div: 2,
				length: 3,
				r: 4,
				step: 6
			});
		}
	}

	/* src/PickTime/Face.svelte generated by Svelte v3.18.1 */

	function add_css$1() {
		var style = element("style");
		style.id = "svelte-xo074x-style";
		style.textContent = "text.svelte-xo074x{dominant-baseline:central;font-size:7px;user-select:none;fill:var(--tt-bright-fg)}text.inner.svelte-xo074x{font-size:5px}";
		append(document.head, style);
	}

	function get_each_context(ctx, list, i) {
		const child_ctx = ctx.slice();
		child_ctx[3] = list[i];
		child_ctx[5] = i;
		return child_ctx;
	}

	// (23:0) {#each markers as t, i}
	function create_each_block(ctx) {
		let text_1;
		let t_value = /*t*/ ctx[3] + "";
		let t;
		let text_1_class_value;
		let text_1_x_value;
		let text_1_y_value;

		return {
			c() {
				text_1 = svg_element("text");
				t = text(t_value);
				this.h();
			},
			l(nodes) {
				text_1 = claim_element(nodes, "text", null, 1);
				var text_1_nodes = children(text_1);
				t = claim_text(text_1_nodes, t_value);
				text_1_nodes.children.forEach(detach);
				this.h();
			},
			h() {
				attr(text_1, "class", text_1_class_value = "" + (null_to_empty(/*className*/ ctx[0]) + " svelte-xo074x"));
				attr(text_1, "x", text_1_x_value = cx(/*i*/ ctx[5], /*r*/ ctx[1]));
				attr(text_1, "y", text_1_y_value = cy(/*i*/ ctx[5], /*r*/ ctx[1]));
				attr(text_1, "text-anchor", "middle");
			},
			m(target, anchor) {
				insert(target, text_1, anchor);
				append(text_1, t);
			},
			p(ctx, dirty) {
				if (dirty & /*markers*/ 4 && t_value !== (t_value = /*t*/ ctx[3] + "")) set_data(t, t_value);

				if (dirty & /*className*/ 1 && text_1_class_value !== (text_1_class_value = "" + (null_to_empty(/*className*/ ctx[0]) + " svelte-xo074x"))) {
					attr(text_1, "class", text_1_class_value);
				}

				if (dirty & /*r*/ 2 && text_1_x_value !== (text_1_x_value = cx(/*i*/ ctx[5], /*r*/ ctx[1]))) {
					attr(text_1, "x", text_1_x_value);
				}

				if (dirty & /*r*/ 2 && text_1_y_value !== (text_1_y_value = cy(/*i*/ ctx[5], /*r*/ ctx[1]))) {
					attr(text_1, "y", text_1_y_value);
				}
			},
			d(detaching) {
				if (detaching) detach(text_1);
			}
		};
	}

	function create_fragment$1(ctx) {
		let each_1_anchor;
		let each_value = /*markers*/ ctx[2];
		let each_blocks = [];

		for (let i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		return {
			c() {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				each_1_anchor = empty();
			},
			l(nodes) {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].l(nodes);
				}

				each_1_anchor = claim_text(nodes, "");
			},
			m(target, anchor) {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(target, anchor);
				}

				insert(target, each_1_anchor, anchor);
			},
			p(ctx, [dirty]) {
				if (dirty & /*className, cx, r, cy, markers*/ 7) {
					each_value = /*markers*/ ctx[2];
					let i;

					for (i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(child_ctx, dirty);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}

					each_blocks.length = each_value.length;
				}
			},
			i: noop,
			o: noop,
			d(detaching) {
				destroy_each(each_blocks, detaching);
				if (detaching) detach(each_1_anchor);
			}
		};
	}

	function instance$1($$self, $$props, $$invalidate) {
		let { class: className = "" } = $$props;
		let { r } = $$props;
		let { markers = [] } = $$props;

		$$self.$set = $$props => {
			if ("class" in $$props) $$invalidate(0, className = $$props.class);
			if ("r" in $$props) $$invalidate(1, r = $$props.r);
			if ("markers" in $$props) $$invalidate(2, markers = $$props.markers);
		};

		return [className, r, markers];
	}

	class Face extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-xo074x-style")) add_css$1();
			init(this, options, instance$1, create_fragment$1, safe_not_equal, { class: 0, r: 1, markers: 2 });
		}
	}

	/* src/PickTime/index.svelte generated by Svelte v3.18.1 */

	function add_css$2() {
		var style = element("style");
		style.id = "svelte-1x2k3gd-style";
		style.textContent = ".PickTime.svelte-1x2k3gd.svelte-1x2k3gd{background:var(--timepick-bg, #edf2f7);width:20rem}svg.svelte-1x2k3gd.svelte-1x2k3gd{margin:1rem}circle.back.svelte-1x2k3gd.svelte-1x2k3gd{fill:white}circle.center.svelte-1x2k3gd.svelte-1x2k3gd{fill:var(--timepick-center, #63b3ed)}.time.svelte-1x2k3gd.svelte-1x2k3gd{line-height:3.5rem}.time.svelte-1x2k3gd .active.svelte-1x2k3gd{box-shadow:0 4px 0 0px var(--timepick-time-active-color, #63b3ed)}.time.svelte-1x2k3gd.svelte-1x2k3gd{font-size:3rem;background:var(--timepick-time-bg, white);text-align:center}";
		append(document.head, style);
	}

	function get_each_context_1(ctx, list, i) {
		const child_ctx = ctx.slice();
		child_ctx[21] = list[i];
		child_ctx[23] = i;
		return child_ctx;
	}

	function get_each_context$1(ctx, list, i) {
		const child_ctx = ctx.slice();
		child_ctx[18] = list[i];
		child_ctx[20] = i;
		return child_ctx;
	}

	function get_each_context_2(ctx, list, i) {
		const child_ctx = ctx.slice();
		child_ctx[21] = list[i];
		child_ctx[23] = i;
		return child_ctx;
	}

	// (188:4) {#if currentMode === 0}
	function create_if_block_3(ctx) {
		let each_1_anchor;
		let current;
		let each_value_2 = modes[/*currentMode*/ ctx[1]].faces;
		let each_blocks = [];

		for (let i = 0; i < each_value_2.length; i += 1) {
			each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
		}

		const out = i => transition_out(each_blocks[i], 1, 1, () => {
			each_blocks[i] = null;
		});

		return {
			c() {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				each_1_anchor = empty();
			},
			l(nodes) {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].l(nodes);
				}

				each_1_anchor = claim_text(nodes, "");
			},
			m(target, anchor) {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(target, anchor);
				}

				insert(target, each_1_anchor, anchor);
				current = true;
			},
			p(ctx, dirty) {
				if (dirty & /*modes, currentMode, hover, time*/ 22) {
					each_value_2 = modes[/*currentMode*/ ctx[1]].faces;
					let i;

					for (i = 0; i < each_value_2.length; i += 1) {
						const child_ctx = get_each_context_2(ctx, each_value_2, i);

						if (each_blocks[i]) {
							each_blocks[i].p(child_ctx, dirty);
							transition_in(each_blocks[i], 1);
						} else {
							each_blocks[i] = create_each_block_2(child_ctx);
							each_blocks[i].c();
							transition_in(each_blocks[i], 1);
							each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
						}
					}

					group_outros();

					for (i = each_value_2.length; i < each_blocks.length; i += 1) {
						out(i);
					}

					check_outros();
				}
			},
			i(local) {
				if (current) return;

				for (let i = 0; i < each_value_2.length; i += 1) {
					transition_in(each_blocks[i]);
				}

				current = true;
			},
			o(local) {
				each_blocks = each_blocks.filter(Boolean);

				for (let i = 0; i < each_blocks.length; i += 1) {
					transition_out(each_blocks[i]);
				}

				current = false;
			},
			d(detaching) {
				destroy_each(each_blocks, detaching);
				if (detaching) detach(each_1_anchor);
			}
		};
	}

	// (190:8) {#if face.markers.includes(time[0])}
	function create_if_block_5(ctx) {
		let current;

		const hand = new Hand({
				props: {
					i: /*face*/ ctx[21].markers.indexOf(/*time*/ ctx[4][0]),
					div: modes[/*currentMode*/ ctx[1]].div,
					length: /*face*/ ctx[21].r,
					r: /*face*/ ctx[21].markerRadius,
					step: modes[/*currentMode*/ ctx[1]].step
				}
			});

		return {
			c() {
				create_component(hand.$$.fragment);
			},
			l(nodes) {
				claim_component(hand.$$.fragment, nodes);
			},
			m(target, anchor) {
				mount_component(hand, target, anchor);
				current = true;
			},
			p(ctx, dirty) {
				const hand_changes = {};
				if (dirty & /*currentMode, time*/ 18) hand_changes.i = /*face*/ ctx[21].markers.indexOf(/*time*/ ctx[4][0]);
				if (dirty & /*currentMode*/ 2) hand_changes.div = modes[/*currentMode*/ ctx[1]].div;
				if (dirty & /*currentMode*/ 2) hand_changes.length = /*face*/ ctx[21].r;
				if (dirty & /*currentMode*/ 2) hand_changes.r = /*face*/ ctx[21].markerRadius;
				if (dirty & /*currentMode*/ 2) hand_changes.step = modes[/*currentMode*/ ctx[1]].step;
				hand.$set(hand_changes);
			},
			i(local) {
				if (current) return;
				transition_in(hand.$$.fragment, local);
				current = true;
			},
			o(local) {
				transition_out(hand.$$.fragment, local);
				current = false;
			},
			d(detaching) {
				destroy_component(hand, detaching);
			}
		};
	}

	// (199:8) {#if face.markers.includes(hover)}
	function create_if_block_4(ctx) {
		let current;

		const hand = new Hand({
				props: {
					i: /*face*/ ctx[21].markers.indexOf(/*hover*/ ctx[2]),
					div: modes[/*currentMode*/ ctx[1]].div,
					length: /*face*/ ctx[21].r,
					class: "hover",
					r: /*face*/ ctx[21].markerRadius,
					step: modes[/*currentMode*/ ctx[1]].step
				}
			});

		return {
			c() {
				create_component(hand.$$.fragment);
			},
			l(nodes) {
				claim_component(hand.$$.fragment, nodes);
			},
			m(target, anchor) {
				mount_component(hand, target, anchor);
				current = true;
			},
			p(ctx, dirty) {
				const hand_changes = {};
				if (dirty & /*currentMode, hover*/ 6) hand_changes.i = /*face*/ ctx[21].markers.indexOf(/*hover*/ ctx[2]);
				if (dirty & /*currentMode*/ 2) hand_changes.div = modes[/*currentMode*/ ctx[1]].div;
				if (dirty & /*currentMode*/ 2) hand_changes.length = /*face*/ ctx[21].r;
				if (dirty & /*currentMode*/ 2) hand_changes.r = /*face*/ ctx[21].markerRadius;
				if (dirty & /*currentMode*/ 2) hand_changes.step = modes[/*currentMode*/ ctx[1]].step;
				hand.$set(hand_changes);
			},
			i(local) {
				if (current) return;
				transition_in(hand.$$.fragment, local);
				current = true;
			},
			o(local) {
				transition_out(hand.$$.fragment, local);
				current = false;
			},
			d(detaching) {
				destroy_component(hand, detaching);
			}
		};
	}

	// (189:6) {#each modes[currentMode].faces as face, i}
	function create_each_block_2(ctx) {
		let show_if_1 = /*face*/ ctx[21].markers.includes(/*time*/ ctx[4][0]);
		let if_block0_anchor;
		let show_if = /*face*/ ctx[21].markers.includes(/*hover*/ ctx[2]);
		let if_block1_anchor;
		let current;
		let if_block0 = show_if_1 && create_if_block_5(ctx);
		let if_block1 = show_if && create_if_block_4(ctx);

		return {
			c() {
				if (if_block0) if_block0.c();
				if_block0_anchor = empty();
				if (if_block1) if_block1.c();
				if_block1_anchor = empty();
			},
			l(nodes) {
				if (if_block0) if_block0.l(nodes);
				if_block0_anchor = claim_text(nodes, ""); /*IF242*/
				if (if_block1) if_block1.l(nodes);
				if_block1_anchor = claim_text(nodes, ""); /*IF242*/
			},
			m(target, anchor) {
				if (if_block0) if_block0.m(target, anchor);
				insert(target, if_block0_anchor, anchor);
				if (if_block1) if_block1.m(target, anchor);
				insert(target, if_block1_anchor, anchor);
				current = true;
			},
			p(ctx, dirty) {
				if (dirty & /*currentMode, time*/ 18) show_if_1 = /*face*/ ctx[21].markers.includes(/*time*/ ctx[4][0]);

				if (show_if_1) {
					if (if_block0) {
						if_block0.p(ctx, dirty);
						transition_in(if_block0, 1);
					} else {
						if_block0 = create_if_block_5(ctx);
						if_block0.c();
						transition_in(if_block0, 1);
						if_block0.m(if_block0_anchor.parentNode, if_block0_anchor);
					}
				} else if (if_block0) {
					group_outros();

					transition_out(if_block0, 1, 1, () => {
						if_block0 = null;
					});

					check_outros();
				}

				if (dirty & /*currentMode, hover*/ 6) show_if = /*face*/ ctx[21].markers.includes(/*hover*/ ctx[2]);

				if (show_if) {
					if (if_block1) {
						if_block1.p(ctx, dirty);
						transition_in(if_block1, 1);
					} else {
						if_block1 = create_if_block_4(ctx);
						if_block1.c();
						transition_in(if_block1, 1);
						if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
					}
				} else if (if_block1) {
					group_outros();

					transition_out(if_block1, 1, 1, () => {
						if_block1 = null;
					});

					check_outros();
				}
			},
			i(local) {
				if (current) return;
				transition_in(if_block0);
				transition_in(if_block1);
				current = true;
			},
			o(local) {
				transition_out(if_block0);
				transition_out(if_block1);
				current = false;
			},
			d(detaching) {
				if (if_block0) if_block0.d(detaching);
				if (detaching) detach(if_block0_anchor);
				if (if_block1) if_block1.d(detaching);
				if (detaching) detach(if_block1_anchor);
			}
		};
	}

	// (211:4) {#if currentMode === 1}
	function create_if_block_1(ctx) {
		let if_block_anchor;
		let current;

		const hand = new Hand({
				props: {
					i: /*time*/ ctx[4][/*currentMode*/ ctx[1]],
					div: modes[/*currentMode*/ ctx[1]].div,
					length: modes[/*currentMode*/ ctx[1]].faces[0].r,
					r: markerRadius[Math.floor(/*time*/ ctx[4][1] / modes[/*currentMode*/ ctx[1]].div)],
					step: modes[/*currentMode*/ ctx[1]].step
				}
			});

		let if_block = /*hover*/ ctx[2] !== null && create_if_block_2(ctx);

		return {
			c() {
				create_component(hand.$$.fragment);
				if (if_block) if_block.c();
				if_block_anchor = empty();
			},
			l(nodes) {
				claim_component(hand.$$.fragment, nodes);
				if (if_block) if_block.l(nodes);
				if_block_anchor = claim_text(nodes, ""); /*IF242*/
			},
			m(target, anchor) {
				mount_component(hand, target, anchor);
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
				current = true;
			},
			p(ctx, dirty) {
				const hand_changes = {};
				if (dirty & /*time, currentMode*/ 18) hand_changes.i = /*time*/ ctx[4][/*currentMode*/ ctx[1]];
				if (dirty & /*currentMode*/ 2) hand_changes.div = modes[/*currentMode*/ ctx[1]].div;
				if (dirty & /*currentMode*/ 2) hand_changes.length = modes[/*currentMode*/ ctx[1]].faces[0].r;
				if (dirty & /*time, currentMode*/ 18) hand_changes.r = markerRadius[Math.floor(/*time*/ ctx[4][1] / modes[/*currentMode*/ ctx[1]].div)];
				if (dirty & /*currentMode*/ 2) hand_changes.step = modes[/*currentMode*/ ctx[1]].step;
				hand.$set(hand_changes);

				if (/*hover*/ ctx[2] !== null) {
					if (if_block) {
						if_block.p(ctx, dirty);
						transition_in(if_block, 1);
					} else {
						if_block = create_if_block_2(ctx);
						if_block.c();
						transition_in(if_block, 1);
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					group_outros();

					transition_out(if_block, 1, 1, () => {
						if_block = null;
					});

					check_outros();
				}
			},
			i(local) {
				if (current) return;
				transition_in(hand.$$.fragment, local);
				transition_in(if_block);
				current = true;
			},
			o(local) {
				transition_out(hand.$$.fragment, local);
				transition_out(if_block);
				current = false;
			},
			d(detaching) {
				destroy_component(hand, detaching);
				if (if_block) if_block.d(detaching);
				if (detaching) detach(if_block_anchor);
			}
		};
	}

	// (218:6) {#if hover !== null}
	function create_if_block_2(ctx) {
		let current;

		const hand = new Hand({
				props: {
					i: /*hover*/ ctx[2],
					div: modes[/*currentMode*/ ctx[1]].div,
					length: modes[/*currentMode*/ ctx[1]].faces[0].r,
					class: "hover",
					r: markerRadius[Math.floor(/*hover*/ ctx[2] / modes[/*currentMode*/ ctx[1]].div)],
					step: modes[/*currentMode*/ ctx[1]].step
				}
			});

		return {
			c() {
				create_component(hand.$$.fragment);
			},
			l(nodes) {
				claim_component(hand.$$.fragment, nodes);
			},
			m(target, anchor) {
				mount_component(hand, target, anchor);
				current = true;
			},
			p(ctx, dirty) {
				const hand_changes = {};
				if (dirty & /*hover*/ 4) hand_changes.i = /*hover*/ ctx[2];
				if (dirty & /*currentMode*/ 2) hand_changes.div = modes[/*currentMode*/ ctx[1]].div;
				if (dirty & /*currentMode*/ 2) hand_changes.length = modes[/*currentMode*/ ctx[1]].faces[0].r;
				if (dirty & /*hover, currentMode*/ 6) hand_changes.r = markerRadius[Math.floor(/*hover*/ ctx[2] / modes[/*currentMode*/ ctx[1]].div)];
				if (dirty & /*currentMode*/ 2) hand_changes.step = modes[/*currentMode*/ ctx[1]].step;
				hand.$set(hand_changes);
			},
			i(local) {
				if (current) return;
				transition_in(hand.$$.fragment, local);
				current = true;
			},
			o(local) {
				transition_out(hand.$$.fragment, local);
				current = false;
			},
			d(detaching) {
				destroy_component(hand, detaching);
			}
		};
	}

	// (230:6) {#if modeIdx === currentMode}
	function create_if_block$1(ctx) {
		let each_1_anchor;
		let current;
		let each_value_1 = /*mode*/ ctx[18].faces;
		let each_blocks = [];

		for (let i = 0; i < each_value_1.length; i += 1) {
			each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
		}

		const out = i => transition_out(each_blocks[i], 1, 1, () => {
			each_blocks[i] = null;
		});

		return {
			c() {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				each_1_anchor = empty();
			},
			l(nodes) {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].l(nodes);
				}

				each_1_anchor = claim_text(nodes, "");
			},
			m(target, anchor) {
				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(target, anchor);
				}

				insert(target, each_1_anchor, anchor);
				current = true;
			},
			p(ctx, dirty) {
				if (dirty & /*modes*/ 0) {
					each_value_1 = /*mode*/ ctx[18].faces;
					let i;

					for (i = 0; i < each_value_1.length; i += 1) {
						const child_ctx = get_each_context_1(ctx, each_value_1, i);

						if (each_blocks[i]) {
							each_blocks[i].p(child_ctx, dirty);
							transition_in(each_blocks[i], 1);
						} else {
							each_blocks[i] = create_each_block_1(child_ctx);
							each_blocks[i].c();
							transition_in(each_blocks[i], 1);
							each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
						}
					}

					group_outros();

					for (i = each_value_1.length; i < each_blocks.length; i += 1) {
						out(i);
					}

					check_outros();
				}
			},
			i(local) {
				if (current) return;

				for (let i = 0; i < each_value_1.length; i += 1) {
					transition_in(each_blocks[i]);
				}

				current = true;
			},
			o(local) {
				each_blocks = each_blocks.filter(Boolean);

				for (let i = 0; i < each_blocks.length; i += 1) {
					transition_out(each_blocks[i]);
				}

				current = false;
			},
			d(detaching) {
				destroy_each(each_blocks, detaching);
				if (detaching) detach(each_1_anchor);
			}
		};
	}

	// (231:8) {#each mode.faces as face, i}
	function create_each_block_1(ctx) {
		let current;

		const face = new Face({
				props: {
					class: /*face*/ ctx[21].class,
					label: /*face*/ ctx[21].label,
					r: /*face*/ ctx[21].r,
					markers: /*face*/ ctx[21].markers,
					turn: /*face*/ ctx[21].turn
				}
			});

		return {
			c() {
				create_component(face.$$.fragment);
			},
			l(nodes) {
				claim_component(face.$$.fragment, nodes);
			},
			m(target, anchor) {
				mount_component(face, target, anchor);
				current = true;
			},
			p: noop,
			i(local) {
				if (current) return;
				transition_in(face.$$.fragment, local);
				current = true;
			},
			o(local) {
				transition_out(face.$$.fragment, local);
				current = false;
			},
			d(detaching) {
				destroy_component(face, detaching);
			}
		};
	}

	// (229:4) {#each modes as mode, modeIdx}
	function create_each_block$1(ctx) {
		let if_block_anchor;
		let current;
		let if_block = /*modeIdx*/ ctx[20] === /*currentMode*/ ctx[1] && create_if_block$1(ctx);

		return {
			c() {
				if (if_block) if_block.c();
				if_block_anchor = empty();
			},
			l(nodes) {
				if (if_block) if_block.l(nodes);
				if_block_anchor = claim_text(nodes, ""); /*IF242*/
			},
			m(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
				current = true;
			},
			p(ctx, dirty) {
				if (/*modeIdx*/ ctx[20] === /*currentMode*/ ctx[1]) {
					if (if_block) {
						if_block.p(ctx, dirty);
						transition_in(if_block, 1);
					} else {
						if_block = create_if_block$1(ctx);
						if_block.c();
						transition_in(if_block, 1);
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					group_outros();

					transition_out(if_block, 1, 1, () => {
						if_block = null;
					});

					check_outros();
				}
			},
			i(local) {
				if (current) return;
				transition_in(if_block);
				current = true;
			},
			o(local) {
				transition_out(if_block);
				current = false;
			},
			d(detaching) {
				if (if_block) if_block.d(detaching);
				if (detaching) detach(if_block_anchor);
			}
		};
	}

	function create_fragment$2(ctx) {
		let div1;
		let div0;
		let span0;
		let t0_value = fmtH(/*time*/ ctx[4][0]) + "";
		let t0;
		let t1;
		let span1;
		let t2_value = fmtH(/*time*/ ctx[4][1]) + "";
		let t2;
		let t3;
		let svg;
		let circle0;
		let circle0_cx_value;
		let circle0_cy_value;
		let circle0_r_value;
		let if_block0_anchor;
		let if_block1_anchor;
		let circle1;
		let circle1_cx_value;
		let circle1_cy_value;
		let div1_class_value;
		let current;
		let dispose;
		let if_block0 = /*currentMode*/ ctx[1] === 0 && create_if_block_3(ctx);
		let if_block1 = /*currentMode*/ ctx[1] === 1 && create_if_block_1(ctx);
		let each_value = modes;
		let each_blocks = [];

		for (let i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
		}

		const out = i => transition_out(each_blocks[i], 1, 1, () => {
			each_blocks[i] = null;
		});

		return {
			c() {
				div1 = element("div");
				div0 = element("div");
				span0 = element("span");
				t0 = text(t0_value);
				t1 = text("\n    :\n    ");
				span1 = element("span");
				t2 = text(t2_value);
				t3 = space();
				svg = svg_element("svg");
				circle0 = svg_element("circle");
				if (if_block0) if_block0.c();
				if_block0_anchor = empty();
				if (if_block1) if_block1.c();
				if_block1_anchor = empty();

				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				circle1 = svg_element("circle");
				this.h();
			},
			l(nodes) {
				div1 = claim_element(nodes, "DIV", null);
				var div1_nodes = children(div1);
				div0 = claim_element(div1_nodes, "DIV", null);
				var div0_nodes = children(div0);
				span0 = claim_element(div0_nodes, "SPAN", null);
				var span0_nodes = children(span0);
				t0 = claim_text(span0_nodes, t0_value);
				span0_nodes.children.forEach(detach);
				t1 = claim_text(div0_nodes, "\n    :\n    ");
				span1 = claim_element(div0_nodes, "SPAN", null);
				var span1_nodes = children(span1);
				t2 = claim_text(span1_nodes, t2_value);
				span1_nodes.children.forEach(detach);
				div0_nodes.children.forEach(detach);
				t3 = claim_space(div1_nodes);
				svg = claim_element(div1_nodes, "svg", null, 1);
				var svg_nodes = children(svg);
				circle0 = claim_element(svg_nodes, "circle", null, 1);
				children(circle0).children.forEach(detach);
				if (if_block0) if_block0.l(svg_nodes);
				if_block0_anchor = claim_text(svg_nodes, ""); /*IF242*/
				if (if_block1) if_block1.l(svg_nodes);
				if_block1_anchor = claim_text(svg_nodes, ""); /*IF242*/

				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].l(svg_nodes);
				}

				circle1 = claim_element(svg_nodes, "circle", null, 1);
				children(circle1).children.forEach(detach);
				svg_nodes.children.forEach(detach);
				div1_nodes.children.forEach(detach);
				this.h();
			},
			h() {
				attr(span0, "class", "hours svelte-1x2k3gd");
				toggle_class(span0, "active", /*currentMode*/ ctx[1] === 0);
				attr(span1, "class", "minutes svelte-1x2k3gd");
				toggle_class(span1, "active", /*currentMode*/ ctx[1] === 1);
				attr(div0, "class", "time bg-white text-center svelte-1x2k3gd");
				attr(circle0, "class", "back svelte-1x2k3gd");
				attr(circle0, "cx", circle0_cx_value = 0);
				attr(circle0, "cy", circle0_cy_value = 0);
				attr(circle0, "r", circle0_r_value = markerDist[0] + markerRadius[0]);
				attr(circle1, "class", "center svelte-1x2k3gd");
				attr(circle1, "cx", circle1_cx_value = 0);
				attr(circle1, "cy", circle1_cy_value = 0);
				attr(circle1, "r", "1");
				attr(svg, "viewBox", "-50 -50 100 100");
				attr(svg, "class", "svelte-1x2k3gd");
				attr(div1, "class", div1_class_value = "PickTime " + /*className*/ ctx[0] + " svelte-1x2k3gd");
			},
			m(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, span0);
				append(span0, t0);
				append(div0, t1);
				append(div0, span1);
				append(span1, t2);
				append(div1, t3);
				append(div1, svg);
				append(svg, circle0);
				if (if_block0) if_block0.m(svg, null);
				append(svg, if_block0_anchor);
				if (if_block1) if_block1.m(svg, null);
				append(svg, if_block1_anchor);

				for (let i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(svg, null);
				}

				append(svg, circle1);
				/*svg_binding*/ ctx[12](svg);
				current = true;

				dispose = [
					listen(span0, "click", /*click_handler*/ ctx[10]),
					listen(span1, "click", /*click_handler_1*/ ctx[11]),
					listen(svg, "touchstart", prevent_default(/*touchstart_handler*/ ctx[13])),
					listen(svg, "touchmove", prevent_default(/*touchmove_handler*/ ctx[14])),
					listen(svg, "touchend", /*up*/ ctx[6], { passive: true }),
					listen(svg, "mousedown", prevent_default(/*mousedown_handler*/ ctx[15])),
					listen(svg, "mousemove", prevent_default(/*mousemove_handler*/ ctx[16])),
					listen(svg, "mouseup", /*up*/ ctx[6]),
					listen(svg, "mouseleave", /*mouseleave_handler*/ ctx[17])
				];
			},
			p(ctx, [dirty]) {
				if ((!current || dirty & /*time*/ 16) && t0_value !== (t0_value = fmtH(/*time*/ ctx[4][0]) + "")) set_data(t0, t0_value);

				if (dirty & /*currentMode*/ 2) {
					toggle_class(span0, "active", /*currentMode*/ ctx[1] === 0);
				}

				if ((!current || dirty & /*time*/ 16) && t2_value !== (t2_value = fmtH(/*time*/ ctx[4][1]) + "")) set_data(t2, t2_value);

				if (dirty & /*currentMode*/ 2) {
					toggle_class(span1, "active", /*currentMode*/ ctx[1] === 1);
				}

				if (/*currentMode*/ ctx[1] === 0) {
					if (if_block0) {
						if_block0.p(ctx, dirty);
						transition_in(if_block0, 1);
					} else {
						if_block0 = create_if_block_3(ctx);
						if_block0.c();
						transition_in(if_block0, 1);
						if_block0.m(svg, if_block0_anchor);
					}
				} else if (if_block0) {
					group_outros();

					transition_out(if_block0, 1, 1, () => {
						if_block0 = null;
					});

					check_outros();
				}

				if (/*currentMode*/ ctx[1] === 1) {
					if (if_block1) {
						if_block1.p(ctx, dirty);
						transition_in(if_block1, 1);
					} else {
						if_block1 = create_if_block_1(ctx);
						if_block1.c();
						transition_in(if_block1, 1);
						if_block1.m(svg, if_block1_anchor);
					}
				} else if (if_block1) {
					group_outros();

					transition_out(if_block1, 1, 1, () => {
						if_block1 = null;
					});

					check_outros();
				}

				if (dirty & /*modes, currentMode*/ 2) {
					each_value = modes;
					let i;

					for (i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context$1(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(child_ctx, dirty);
							transition_in(each_blocks[i], 1);
						} else {
							each_blocks[i] = create_each_block$1(child_ctx);
							each_blocks[i].c();
							transition_in(each_blocks[i], 1);
							each_blocks[i].m(svg, circle1);
						}
					}

					group_outros();

					for (i = each_value.length; i < each_blocks.length; i += 1) {
						out(i);
					}

					check_outros();
				}

				if (!current || dirty & /*className*/ 1 && div1_class_value !== (div1_class_value = "PickTime " + /*className*/ ctx[0] + " svelte-1x2k3gd")) {
					attr(div1, "class", div1_class_value);
				}
			},
			i(local) {
				if (current) return;
				transition_in(if_block0);
				transition_in(if_block1);

				for (let i = 0; i < each_value.length; i += 1) {
					transition_in(each_blocks[i]);
				}

				current = true;
			},
			o(local) {
				transition_out(if_block0);
				transition_out(if_block1);
				each_blocks = each_blocks.filter(Boolean);

				for (let i = 0; i < each_blocks.length; i += 1) {
					transition_out(each_blocks[i]);
				}

				current = false;
			},
			d(detaching) {
				if (detaching) detach(div1);
				if (if_block0) if_block0.d();
				if (if_block1) if_block1.d();
				destroy_each(each_blocks, detaching);
				/*svg_binding*/ ctx[12](null);
				run_all(dispose);
			}
		};
	}

	const markerDist = [40, 26]; // [outer, inner]
	const markerRadius = [9, 7];

	const moveHour = pos => {
		const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);

		// s: 0.5 ... 12.5
		const s = (Math.PI + -Math.atan2(pos.x, pos.y)) / Math.PI / 2 * 12 + 0.5;

		// s1: 0 .. 11
		const s1 = Math.floor(s >= 12 ? 0 : s);

		const isInner = dist < markerDist[1] + markerRadius[1];
		const isPM = s1 === 0 ? !isInner : isInner;
		return s1 + (isPM ? 0 : 12);
	};

	const moveMinute = pos => {
		// s: 0.5 ... 60.5
		const s = (Math.PI + -Math.atan2(pos.x, pos.y)) / Math.PI / 2 * 60 + 0.5;

		// s1: 0 .. 59
		return Math.floor(s >= 60 ? 0 : s);
	};

	const fmtH = h => `0${h}`.substr(-2);

	const modes = [
		{
			div: 12,
			faces: [
				{
					r: markerDist[0],
					markers: [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
					markerRadius: markerRadius[0],
					label: i => i + 1,
					turn: 0
				},
				{
					r: markerDist[1],
					markers: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
					markerRadius: markerRadius[1],
					label: i => i < 11 ? i + 13 : 0,
					class: "inner",
					turn: 0
				}
			]
		},
		{
			div: 60,
			step: 5,
			faces: [
				{
					r: markerDist[0],
					markerRadius: markerRadius[0],
					markers: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
					label: i => i * 5,
					turn: -1
				}
			]
		}
	];

	function instance$2($$self, $$props, $$invalidate) {
		const dispatch = createEventDispatcher();
		let { class: className = "" } = $$props;
		let { timestamp = new Date() } = $$props;
		let currentMode = 0; // hours, minutes
		let hover = null;
		let svgRef;

		const move = (e, changeHover = true) => {
			if (!changeHover) {
				$$invalidate(2, hover = null);
			}

			const pos = cursorPoint(e);
			const r = currentMode === 0 ? moveHour(pos) : moveMinute(pos);

			if (changeHover) {
				$$invalidate(2, hover = r);
			} else {
				$$invalidate(4, time[currentMode] = r, time);
			}
		};

		const up = () => {
			if (currentMode === 0) {
				timestamp.setHours(time[currentMode]);
				$$invalidate(1, currentMode = 1);
			}

			if (currentMode === 1) {
				timestamp.setMinutes(time[currentMode]);
				timestamp.setSeconds(0);
				timestamp.setMilliseconds(0);
			}

			$$invalidate(2, hover = null);
			$$invalidate(7, timestamp);
			dispatch("input", timestamp);
		};

		const click_handler = () => $$invalidate(1, currentMode = 0);
		const click_handler_1 = () => $$invalidate(1, currentMode = 1);

		function svg_binding($$value) {
			binding_callbacks[$$value ? "unshift" : "push"](() => {
				$$invalidate(3, svgRef = $$value);
			});
		}

		const touchstart_handler = e => move(e.changedTouches[0], false);
		const touchmove_handler = e => move(e.changedTouches[0], false);
		const mousedown_handler = e => move(e, false);
		const mousemove_handler = e => move(e, !e.buttons);
		const mouseleave_handler = () => $$invalidate(2, hover = null);

		$$self.$set = $$props => {
			if ("class" in $$props) $$invalidate(0, className = $$props.class);
			if ("timestamp" in $$props) $$invalidate(7, timestamp = $$props.timestamp);
		};

		let time;
		let cursorPoint;

		$$self.$$.update = () => {
			if ($$self.$$.dirty & /*timestamp*/ 128) {
				 $$invalidate(4, time = [timestamp.getHours(), timestamp.getMinutes()]);
			}

			if ($$self.$$.dirty & /*svgRef*/ 8) {
				 cursorPoint = (() => {
					if (svgRef) {
						const pt = svgRef.createSVGPoint();

						return evt => {
							// https://stackoverflow.com/questions/10298658/mouse-position-inside-autoscaled-svg
							pt.x = evt.clientX;

							pt.y = evt.clientY;
							return pt.matrixTransform(svgRef.getScreenCTM().inverse());
						};
					}
				})();
			}
		};

		return [
			className,
			currentMode,
			hover,
			svgRef,
			time,
			move,
			up,
			timestamp,
			cursorPoint,
			dispatch,
			click_handler,
			click_handler_1,
			svg_binding,
			touchstart_handler,
			touchmove_handler,
			mousedown_handler,
			mousemove_handler,
			mouseleave_handler
		];
	}

	class PickTime extends SvelteComponent {
		constructor(options) {
			super();
			if (!document.getElementById("svelte-1x2k3gd-style")) add_css$2();
			init(this, options, instance$2, create_fragment$2, safe_not_equal, { class: 0, timestamp: 7 });
		}
	}

	return PickTime;

})));
