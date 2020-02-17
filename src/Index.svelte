<script>
  import PickTime from './PickTime/index.svelte';

  let timestamp = new Date();
</script>

<style>
  :global(.with-style) {
    --timepick-bg: red;
    --timepick-center: blue;
    --timepick-time-bg: yellow;
    --timepick-hand-active-color: pink;
    --timepick-hand-hover-color: slategray;
    --timepick-time-active-color: orange;
  }
</style>

<html lang="en">
  <head></head>
  <body>
    timestamp: {timestamp.toLocaleString()}
    <hr />
    <PickTime bind:timestamp />
    <hr />
    <PickTime class="with-style" bind:timestamp />
  </body>
</html>
