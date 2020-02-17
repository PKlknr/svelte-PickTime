<script>
  import {cx, cy} from './util.js';

  let className = '';
  export {className as class};
  export let i;
  export let div;
  export let length;
  export let r;
  export let step = 0;

  let betweenDiv;
  $: betweenDiv = step && i % step !== 0;
</script>

<style>
  line {
    stroke: var(--timepick-hand-active-color, #63b3ed);
    stroke-width: 0.5;
    transition-property: all;
    transition-duration: 0.24s;
  }
  .betweenDiv {
    stroke: white;
  }

  circle.active {
    fill: var(--timepick-hand-active-color, #63b3ed);
  }
  circle.hover {
    fill: var(--timepick-hand-hover-color, #e2e8f0);
  }
  line.hover {
    stroke: var(--timepick-hand-hover-color, #e2e8f0);
  }
</style>

<svelte:options namespace="svg" />
<line
  class="{className}"
  x1="{0}"
  y1="{0}"
  x2="{cx(i, length, div)}"
  y2="{cy(i, length, div)}"></line>
<circle
  class="active {className}"
  cx="{cx(i, length, div)}"
  cy="{cy(i, length, div)}"
  {r}></circle>
{#if betweenDiv}
  <line
    class="betweenDiv"
    x1="{cx(i, length - 3, div)}"
    y1="{cy(i, length - 3, div)}"
    x2="{cx(i, length + 3, div)}"
    y2="{cy(i, length + 3, div)}"></line>
{/if}
