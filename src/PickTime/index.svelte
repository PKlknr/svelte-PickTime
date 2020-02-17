<script context="module">
  const markerDist = [40, 26]; // [outer, inner]
  const markerRadius = [9, 7];

  const moveHour = pos => {
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);

    // s: 0.5 ... 12.5
    const s = ((Math.PI + -Math.atan2(pos.x, pos.y)) / Math.PI / 2) * 12 + 0.5;

    // s1: 0 .. 11
    const s1 = Math.floor(s >= 12 ? 0 : s);

    const isInner = dist < markerDist[1] + markerRadius[1];
    const isPM = s1 === 0 ? !isInner : isInner;

    return s1 + (isPM ? 0 : 12);
  };

  const moveMinute = pos => {
    // s: 0.5 ... 60.5
    const s = ((Math.PI + -Math.atan2(pos.x, pos.y)) / Math.PI / 2) * 60 + 0.5;

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
        },
        {
          r: markerDist[1],
          markers: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          markerRadius: markerRadius[1],
          class: 'inner',
        },
      ],
    },
    {
      div: 60,
      step: 5,
      faces: [
        {
          r: markerDist[0],
          markerRadius: markerRadius[0],
          markers: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
        },
      ],
    },
  ];
</script>

<script>
  import {createEventDispatcher} from 'svelte';
  import Hand from './Hand.svelte';
  import Face from './Face.svelte';

  const dispatch = createEventDispatcher();

  let className = '';
  export {className as class};
  export let timestamp = new Date();

  let currentMode = 0; // hours, minutes
  let hover = null;
  let svgRef;

  $: time = [timestamp.getHours(), timestamp.getMinutes()];

  $: cursorPoint = (() => {
    if (svgRef) {
      const pt = svgRef.createSVGPoint();
      return evt => {
        // https://stackoverflow.com/questions/10298658/mouse-position-inside-autoscaled-svg
        pt.x = evt.clientX;
        pt.y = evt.clientY;
        return pt.matrixTransform(svgRef.getScreenCTM().inverse());
      };
    }
  })(svgRef);

  const move = (e, changeHover = true) => {
    if (!changeHover) {
      hover = null;
    }
    const pos = cursorPoint(e);

    const r = currentMode === 0 ? moveHour(pos) : moveMinute(pos);
    if (changeHover) {
      hover = r;
    } else {
      time[currentMode] = r;
    }
  };

  const up = () => {
    if (currentMode === 0) {
      timestamp.setHours(time[currentMode]);
      currentMode = 1;
    }
    if (currentMode === 1) {
      timestamp.setMinutes(time[currentMode]);
      timestamp.setSeconds(0);
      timestamp.setMilliseconds(0);
    }
    hover = null;
    timestamp = timestamp;
    dispatch('input', timestamp);
  };
</script>

<style>
  .PickTime {
    background: var(--timepick-bg, #edf2f7);
    width: 20rem;
  }
  svg {
    margin: 1rem;
  }
  circle.back {
    fill: white;
  }
  circle.center {
    fill: var(--timepick-center, #63b3ed);
  }
  .time {
    line-height: 3.5rem;
  }
  .time .active {
    box-shadow: 0 4px 0 0px var(--timepick-time-active-color, #63b3ed);
  }

  .time {
    font-size: 3rem;
    background: var(--timepick-time-bg, white);
    text-align: center;
  }
</style>

<div class="PickTime {className}">
  <div class="text-center bg-white time">
    <span
      class="hours"
      class:active="{currentMode === 0}"
      on:click="{() => (currentMode = 0)}">
      {fmtH(time[0])}
    </span>
    :
    <span
      class="minutes"
      class:active="{currentMode === 1}"
      on:click="{() => (currentMode = 1)}">
      {fmtH(time[1])}
    </span>
  </div>

  <svg
    viewBox="-50 -50 100 100"
    bind:this="{svgRef}"
    on:touchstart|preventDefault="{e => move(e.changedTouches[0], false)}"
    on:touchmove|preventDefault="{e => move(e.changedTouches[0], false)}"
    on:touchend="{up}"
    on:mousedown|preventDefault="{e => move(e, false)}"
    on:mousemove|preventDefault="{e => move(e, !e.buttons)}"
    on:mouseup="{up}"
    on:mouseleave="{() => (hover = null)}">

    <circle
      class="back"
      cx="{0}"
      cy="{0}"
      r="{markerDist[0] + markerRadius[0]}"></circle>

    {#if currentMode === 0}
      {#each modes[currentMode].faces as face, i}
        {#if face.markers.includes(time[0])}
          <Hand
            i="{face.markers.indexOf(time[0])}"
            div="{modes[currentMode].div}"
            length="{face.r}"
            r="{face.markerRadius}"
            step="{modes[currentMode].step}" />
        {/if}

        {#if face.markers.includes(hover)}
          <Hand
            i="{face.markers.indexOf(hover)}"
            div="{modes[currentMode].div}"
            length="{face.r}"
            class="hover"
            r="{face.markerRadius}"
            step="{modes[currentMode].step}" />
        {/if}
      {/each}
    {/if}

    {#if currentMode === 1}
      <Hand
        i="{time[currentMode]}"
        div="{modes[currentMode].div}"
        length="{modes[currentMode].faces[0].r}"
        r="{markerRadius[Math.floor(time[1] / modes[currentMode].div)]}"
        step="{modes[currentMode].step}" />
      {#if hover !== null}
        <Hand
          i="{hover}"
          div="{modes[currentMode].div}"
          length="{modes[currentMode].faces[0].r}"
          class="hover"
          r="{markerRadius[Math.floor(hover / modes[currentMode].div)]}"
          step="{modes[currentMode].step}" />
      {/if}
    {/if}

    {#each modes as mode, modeIdx}
      {#if modeIdx === currentMode}
        {#each mode.faces as face, i}
          <Face class="{face.class}" r="{face.r}" markers="{face.markers}" />
        {/each}
      {/if}
    {/each}

    <circle class="center" cx="{0}" cy="{0}" r="1"></circle>

  </svg>
</div>
