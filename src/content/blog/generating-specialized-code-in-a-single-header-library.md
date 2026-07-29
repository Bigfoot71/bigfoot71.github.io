---
title: "Generating specialized code in a single-header library"
description: "A self-inclusion trick to generate specialized function variants at compile time, without leaving the single-header constraint."
date: 2026-07-29
tags: ["c", "pre-processor", "meta-programming"]
---

To kick off this blog, I want to share a small trick I came up with while working on [rlsw.h](https://github.com/raysan5/raylib/blob/master/src/external/rlsw.h), the software rendering backend I contributed to [raylib](https://www.raylib.com/).

## The goal

rlsw aims to support the same feature set already exposed by [rlgl.h](https://github.com/raysan5/raylib/blob/master/src/rlgl.h) for OpenGL 1.1, like rasterizing points, lines, triangles and quads, nearest/linear texturing, blend modes, depth testing, scissor clipping, and so on.

The catch: it has to stay a single header.

And since one of the goals was to run on fairly constrained hardware (like [ESP32](https://en.wikipedia.org/wiki/ESP32)), performance matters just as much as feature coverage.

## Why dynamic branching doesn't cut it

The naive way to support all these states is to check them per pixel:

```c
for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
        if (state & DEPTH_TEST) {
            if (frag_depth > get_depth(x, y)) continue;
        }

        Color result = frag_color;

        if (state & TEXTURING) {
            result *= sample_texture(texture, frag_texcoord);
        }

        if (state & BLENDING) {
            result = blend(result, get_color(x, y));
        }

        set_color(x, y, result);
    }
}
```

This example is extremely simplified, but even like this, every pixel pays the cost of branches that resolve the same way for the entire draw call. What we actually want is a specialized version of this loop for each combination of states, generated ahead of time rather than branched on at runtime.

Writing every combination by hand isn't realistic though; the number of states involved makes that grow out of hand fast.

## Templating through repeated inclusion

This isn't a new idea. Mesa's software rasterizer does something similar with [s_tritemp.h](https://cgit.arctica-project.org/vcxsrv/tree/mesalib/src/mesa/swrast/s_tritemp.h): a template file gets included multiple times, each time with a different set of macros defined beforehand, producing a specialized function per combination.

The difference with rlsw is the single-header constraint: there's no separate template file to include. So the header needs to include *itself*, which C actually allows via `__FILE__`:

```c
// somewhere near the top of the header, for every state
// combination we want to generate:
#define SW_DRAW_FLAGS (SW_BLENDING)
#include __FILE__
#undef SW_DRAW_FLAGS

#define SW_DRAW_FLAGS (SW_BLENDING | SW_TEXTURING)
#include __FILE__
#undef SW_DRAW_FLAGS

// ... one block per combination we care about

// a dispatch table mapping pipeline state to the right function
static RasterFn dispatch_table[] = {
    [SW_BLENDING]                  = SW_RASTER_NAME(SW_BLENDING),
    [SW_BLENDING | SW_TEXTURING]   = SW_RASTER_NAME(SW_BLENDING | SW_TEXTURING),
    // ...
};

void draw_triangle(void) {
    dispatch_table[ctx.state]();
}
```

```c
// further down in the same header: the actual template,
// only compiled when the header re-includes itself
#ifdef SW_DRAW_FLAGS

void SW_RASTER_NAME(SW_DRAW_FLAGS)(void) {
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            #if (SW_DRAW_FLAGS & SW_DEPTH_TEST)
                if (frag_depth > get_depth(x, y)) continue;
            #endif

            Color result = frag_color;

            #if (SW_DRAW_FLAGS & SW_TEXTURING)
                result *= sample_texture(texture, frag_texcoord);
            #endif

            #if (SW_DRAW_FLAGS & SW_BLENDING)
                result = blend(result, get_color(x, y));
            #endif

            set_color(x, y, result);
        }
    }
}

#endif
```

`SW_RASTER_NAME` is a small token-pasting macro that turns the flag combination into a unique function name, so each specialization gets its own symbol instead of colliding. The real implementation in rlsw handles a few more details around include guards and name generation than shown here; the full version is [in the source](https://github.com/raysan5/raylib/blob/master/src/external/rlsw.h#L2994-L3138) if you want to see it end to end.

## Trade-offs

This isn't free. The number of specializations grows with every state you add to the combination, and at some point code size starts to matter, especially on the kind of constrained targets rlsw is meant to run on. It's a balance between avoiding per-pixel branching and not generating more code than a given target can afford.

Still, I think this pattern is useful beyond software rendering. Any single-header C project juggling a handful of orthogonal compile-time options could reach for the same trick.

If you've seen this self-inclusion approach used elsewhere, I'd be curious to hear about it, feel free to reach out.
