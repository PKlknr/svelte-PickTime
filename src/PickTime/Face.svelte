<script>
  import {cx, cy} from './util.js';

  let className = '';
  export {className as class};
  export let r;
  export let markers = [];
</script>

<style>
  text {
    dominant-baseline: central;
    font-size: 7px;
    user-select: none;
    fill: var(--tt-bright-fg);
  }
  text.inner {
    font-size: 5px;
  }
</style>

<svelte:options namespace="svg" />
{#each markers as t, i}
  <text class="{className}" x="{cx(i, r)}" y="{cy(i, r)}" text-anchor="middle">
    {t}
  </text>
{/each}
