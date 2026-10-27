---
title: "Generating specialized code in a single-header library"
description: "A self-inclusion trick to generate specialized function variants at compile time, without leaving the single-header constraint."
date: 2026-10-28
tags: ["c", "meta-programming"]
---

I contributed [rlsw.h](https://github.com/raysan5/raylib/blob/master/src/external/rlsw.h) to [raylib](https://www.raylib.com/), a software renderer that implements the same feature set as [rlgl.h](https://github.com/raysan5/raylib/blob/master/src/rlgl.h) with OpenGL 1.1 as backend (points, lines, triangles, texturing, blending, depth test, scissor...). It has to stay a single header, and it has to be fast enough for constrained targets like the [ESP32](https://en.wikipedia.org/wiki/ESP32).

This post is about one trick I used to get there. I thought I had come up with it, then found out it already existed. I'm sharing it anyway, because I haven't seen it used in single-header libraries.

## The problem

Supporting every combination of states naively means checking them per pixel:

```c
for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
        if (state & DEPTH_TEST) {
            if (frag_depth > get_depth(x, y)) continue;
        }

        Color result = frag_color;

        if (state & TEXTURING) result *= sample_texture(texture, frag_texcoord);
        if (state & BLENDING)  result = blend(result, get_color(x, y));

        set_color(x, y, result);
    }
}
```

Those branches resolve the same way for the whole draw call, yet every pixel pays for them. What we want is one specialized loop per combination of states, and writing them all by hand doesn't scale.

## Templating by including a file repeatedly

Mesa's software rasterizer already does this with [s_tritemp.h](https://cgit.arctica-project.org/vcxsrv/tree/mesalib/src/mesa/swrast/s_tritemp.h), a template file is included several times, each time with different macros defined, and each inclusion produces a specialized function.

That needs a separate template file, which a single header can't have. The workaround is to have the header include itself through `__FILE__`:

```c
#ifndef SW_DRAW_FLAGS
// normal pass: the library itself

#define SW_DRAW_FLAGS (SW_BLENDING)
#include __FILE__
#undef SW_DRAW_FLAGS

#define SW_DRAW_FLAGS (SW_BLENDING | SW_TEXTURING)
#include __FILE__
#undef SW_DRAW_FLAGS

// ... one block per combination

static RasterFn dispatch_table[] = {
    [SW_BLENDING]                = SW_RASTER_NAME(SW_BLENDING),
    [SW_BLENDING | SW_TEXTURING] = SW_RASTER_NAME(SW_BLENDING | SW_TEXTURING),
    // ...
};

void draw_triangle(void) { dispatch_table[ctx.state](); }

#else
// template pass: only compiled on self-inclusion

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

#endif // SW_DRAW_FLAGS
```

`SW_DRAW_FLAGS` is what tells the two passes apart, when it's defined, the header is being re-included as a template and only the function body is compiled. `SW_RASTER_NAME` is a token-pasting macro that turns the flags into a unique function name. The real implementation has a few more details; see [in the source](https://github.com/raysan5/raylib/blob/master/src/external/rlsw.h#L2962-L3030).

## Conclusion

Each state you add multiplies the number of specializations, and code size grows with it. On small targets you have to pick which combinations are worth generating.

The trick isn't limited to rendering per se, it can be useful in any single-header C library that needs templated functions. If you know of other projects using it, I'd love to hear about them!
