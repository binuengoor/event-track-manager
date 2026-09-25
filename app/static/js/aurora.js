/**
 * Google Gemini iOS Ambient Aurora Effect
 * Modeled directly after the Gemini iOS app ambient light:
 * - Minimal, ethereal, breathing ambient light that comes and goes.
 * - Periodic intervals of pure OLED black (#000000) where the light completely rests.
 * - Single/dual harmonized color moods that slowly transition over time:
 *     * Mood 1: Deep Emerald & Luminous Teal (iOS Screen 1)
 *     * Mood 2: Deep Sapphire & Royal Blue (iOS Screen 2 & 4)
 *     * Mood 3: Radiant Purple & Electric Violet (iOS Screen 5)
 *     * Mood 4: Warm Rose Magenta & Amber Gold (iOS Screen 3)
 * - Ultra-soft Gaussian atmospheric diffusion with zero harsh lines or rainbow bands.
 */

(function () {
  'use strict';

  const VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER_SOURCE = `
    precision highp float;
    varying vec2 v_uv;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_intensity;

    // Simplex Noise 2D
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);

      // Coordinate space: (0,0) at top-left, y increasing downwards
      float x = uv.x;
      float y = 1.0 - uv.y;

      // Slow, hypnotic time base
      float t = u_time * 0.032;

      // Ultra-wide organic simplex warp (liquid celestial cloud)
      vec2 warp = vec2(
        snoise(vec2(x * 1.1 + t * 0.18, y * 1.3 - t * 0.14)),
        snoise(vec2(x * 1.3 - t * 0.15, y * 1.2 + t * 0.16))
      ) * 0.14;

      vec2 p = vec2(x * aspect, y) + warp;

      // -----------------------------------------------------------------------
      // 1. Color Mood Cross-Fading (Smoothly evolves every ~25-35s)
      // -----------------------------------------------------------------------
      float moodCycle = fract(t * 0.06); // 0.0 to 1.0
      float moodPhase = moodCycle * 4.0; // 0 to 4
      int moodIndex = int(floor(moodPhase));
      float moodFrac = smoothstep(0.0, 1.0, fract(moodPhase));

      // Palettes sampled directly from Gemini iOS app:
      // Mood 0: Emerald / Deep Teal
      vec3 c0_a = vec3(0.015, 0.480, 0.320); // Emerald
      vec3 c0_b = vec3(0.010, 0.360, 0.420); // Deep Teal
      // Mood 1: Royal Sapphire / Deep Azure
      vec3 c1_a = vec3(0.060, 0.280, 0.820); // Royal Blue
      vec3 c1_b = vec3(0.020, 0.180, 0.600); // Sapphire
      // Mood 2: Rich Violet / Purple
      vec3 c2_a = vec3(0.460, 0.140, 0.740); // Radiant Purple
      vec3 c2_b = vec3(0.240, 0.100, 0.620); // Deep Indigo
      // Mood 3: Warm Rose / Amber
      vec3 c3_a = vec3(0.780, 0.160, 0.420); // Warm Rose
      vec3 c3_b = vec3(0.720, 0.400, 0.080); // Amber Gold

      vec3 colA;
      vec3 colB;

      if (moodIndex == 0) {
        colA = mix(c0_a, c1_a, moodFrac);
        colB = mix(c0_b, c1_b, moodFrac);
      } else if (moodIndex == 1) {
        colA = mix(c1_a, c2_a, moodFrac);
        colB = mix(c1_b, c2_b, moodFrac);
      } else if (moodIndex == 2) {
        colA = mix(c2_a, c3_a, moodFrac);
        colB = mix(c2_b, c3_b, moodFrac);
      } else {
        colA = mix(c3_a, c0_a, moodFrac);
        colB = mix(c3_b, c0_b, moodFrac);
      }

      // -----------------------------------------------------------------------
      // 2. "Come and Go, and Sometimes Just Be Black" Breathing Cycles
      // -----------------------------------------------------------------------
      // Blob 1 breathing envelope: spends ~35% of the time fully in 0.0 (pitch black)
      float breath1 = sin(t * 1.10);
      float b1 = clamp((breath1 - 0.15) / 0.85, 0.0, 1.0);
      b1 = smoothstep(0.0, 1.0, b1);

      // Blob 2 breathing envelope: phase offset so they emerge independently
      float breath2 = sin(t * 0.85 + 2.3);
      float b2 = clamp((breath2 - 0.20) / 0.80, 0.0, 1.0);
      b2 = smoothstep(0.0, 1.0, b2);

      // -----------------------------------------------------------------------
      // 3. Gentle Celestial Wandering Paths (Anchored to top 25%-40%)
      // -----------------------------------------------------------------------
      vec2 center1 = vec2((0.30 + 0.18 * sin(t * 0.70)) * aspect, 0.14 + 0.10 * cos(t * 0.55));
      vec2 center2 = vec2((0.70 + 0.20 * cos(t * 0.60)) * aspect, 0.18 + 0.12 * sin(t * 0.65));

      float d1 = length(p - center1);
      float d2 = length(p - center2);

      // Ultra-wide Gaussian atmospheric diffusion (no sharp crests, pure velvet fog)
      float energy1 = exp(-d1 * d1 * 2.8) * b1;
      float energy2 = exp(-d2 * d2 * 2.5) * b2;

      // Soft ambient light synthesis (1 or 2 subtle tones only)
      vec3 light = colA * energy1 * 1.45 + colB * energy2 * 1.35;

      // Smooth vertical dissipation: completely pure OLED black past top 40%
      float vertFade = smoothstep(0.48, 0.02, y);
      vertFade = pow(vertFade, 1.5);

      vec3 finalColor = light * vertFade * u_intensity;

      // Micro-dither
      float dither = (hash(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
      finalColor = max(vec3(0.0), finalColor + dither);

      // Alpha: 0.0 during rest periods (pure OLED black), gentle luminescence during peaks
      float alpha = clamp(length(finalColor) * 1.5, 0.0, 1.0);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  // ---------------------------------------------------------------------------
  // Aurora Controller Class
  // ---------------------------------------------------------------------------
  class AuroraController {
    constructor(container, options = {}) {
      this.container = container;
      this.options = Object.assign(
        {
          speed: 1.0,
          intensity: 0.95,
          activeSpeed: 2.0,
          activeIntensity: 1.35,
        },
        options
      );

      this.isActive = false;
      this.currentSpeed = this.options.speed;
      this.targetSpeed = this.options.speed;
      this.currentIntensity = this.options.intensity;
      this.targetIntensity = this.options.intensity;

      this.virtualTime = Math.random() * 50.0;
      this.lastFrameTime = performance.now();
      this.animationFrameId = null;
      this.isDestroyed = false;

      this.initDOM();
      this.initWebGL();
      this.bindEvents();
    }

    initDOM() {
      let canvas = this.container.querySelector('.aurora-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'aurora-canvas';
        this.container.appendChild(canvas);
      }
      this.canvas = canvas;

      let fallback = this.container.querySelector('.aurora-fallback');
      if (!fallback) {
        fallback = document.createElement('div');
        fallback.className = 'aurora-fallback';
        this.container.appendChild(fallback);
      }
      this.fallback = fallback;
    }

    initWebGL() {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.enableFallback('reduced-motion');
        return;
      }

      const glOpts = {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        powerPreference: 'low-power',
      };

      this.gl = this.canvas.getContext('webgl', glOpts) || this.canvas.getContext('experimental-webgl', glOpts);

      if (!this.gl) {
        this.enableFallback('no-webgl');
        return;
      }

      const gl = this.gl;

      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VERTEX_SHADER_SOURCE);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        console.warn('Aurora: VS error:', gl.getShaderInfoLog(vs));
        this.enableFallback('shader-error');
        return;
      }

      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, FRAGMENT_SHADER_SOURCE);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        console.warn('Aurora: FS error:', gl.getShaderInfoLog(fs));
        this.enableFallback('shader-error');
        return;
      }

      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.warn('Aurora: Link error:', gl.getProgramInfoLog(this.program));
        this.enableFallback('program-link-error');
        return;
      }

      gl.useProgram(this.program);

      const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      const aPos = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      this.uniforms = {
        resolution: gl.getUniformLocation(this.program, 'u_resolution'),
        time: gl.getUniformLocation(this.program, 'u_time'),
        intensity: gl.getUniformLocation(this.program, 'u_intensity'),
      };

      this.resize();
      this.startLoop();
    }

    enableFallback(reason) {
      this.container.classList.add('aurora-no-webgl');
      if (this.canvas) {
        this.canvas.style.display = 'none';
      }
      if (this.fallback) {
        this.fallback.style.display = 'block';
      }
    }

    resize() {
      if (!this.gl || !this.canvas) return;

      const width = window.innerWidth;
      const height = window.innerHeight;

      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const renderW = Math.floor(width * dpr);
      const renderH = Math.floor(height * dpr);

      if (this.canvas.width !== renderW || this.canvas.height !== renderH) {
        this.canvas.width = renderW;
        this.canvas.height = renderH;
        this.gl.viewport(0, 0, renderW, renderH);
        this.gl.useProgram(this.program);
        this.gl.uniform2f(this.uniforms.resolution, renderW, renderH);
      }
    }

    startLoop() {
      if (this.animationFrameId || this.isDestroyed || !this.gl) return;

      this.lastFrameTime = performance.now();
      const render = (now) => {
        if (this.isDestroyed) return;

        const delta = Math.min((now - this.lastFrameTime) / 1000.0, 0.1);
        this.lastFrameTime = now;

        this.currentSpeed += (this.targetSpeed - this.currentSpeed) * 0.04;
        this.currentIntensity += (this.targetIntensity - this.currentIntensity) * 0.04;

        this.virtualTime += delta * this.currentSpeed;

        const gl = this.gl;
        gl.useProgram(this.program);
        gl.uniform1f(this.uniforms.time, this.virtualTime);
        gl.uniform1f(this.uniforms.intensity, this.currentIntensity);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        this.animationFrameId = requestAnimationFrame(render);
      };

      this.animationFrameId = requestAnimationFrame(render);
    }

    stopLoop() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    setActive(active = true, durationMs = 0) {
      this.isActive = !!active;
      if (this.isActive) {
        this.targetSpeed = this.options.activeSpeed;
        this.targetIntensity = this.options.activeIntensity;

        if (durationMs > 0) {
          clearTimeout(this._activeTimer);
          this._activeTimer = setTimeout(() => {
            this.setActive(false);
          }, durationMs);
        }
      } else {
        this.targetSpeed = this.options.speed;
        this.targetIntensity = this.options.intensity;
      }
    }

    bindEvents() {
      let resizeTimeout = null;
      this._onResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.resize(), 100);
      };
      window.addEventListener('resize', this._onResize, { passive: true });

      this._onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          this.stopLoop();
        } else {
          this.startLoop();
        }
      };
      document.addEventListener('visibilitychange', this._onVisibilityChange);

      this._onContextLost = (e) => {
        e.preventDefault();
        this.stopLoop();
      };
      this._onContextRestored = () => {
        this.initWebGL();
      };
      this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
      this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

      if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._onReducedMotion = (e) => {
          if (e.matches) {
            this.stopLoop();
            this.enableFallback('reduced-motion');
          } else {
            this.container.classList.remove('aurora-no-webgl');
            if (this.canvas) this.canvas.style.display = 'block';
            if (this.fallback) this.fallback.style.display = 'none';
            this.initWebGL();
          }
        };
        try {
          mediaQuery.addEventListener('change', this._onReducedMotion);
        } catch {
          mediaQuery.addListener(this._onReducedMotion);
        }
      }
    }

    destroy() {
      this.isDestroyed = true;
      this.stopLoop();
      window.removeEventListener('resize', this._onResize);
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      if (this.canvas) {
        this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
        this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Custom Web Component: <aurora-background>
  // ---------------------------------------------------------------------------
  class AuroraBackgroundElement extends HTMLElement {
    connectedCallback() {
      const speed = parseFloat(this.getAttribute('speed')) || 1.0;
      const intensity = parseFloat(this.getAttribute('intensity')) || 0.95;
      const activeSpeed = parseFloat(this.getAttribute('active-speed')) || 2.0;
      const activeIntensity = parseFloat(this.getAttribute('active-intensity')) || 1.35;

      this.controller = new AuroraController(this, {
        speed,
        intensity,
        activeSpeed,
        activeIntensity,
      });

      if (!window.auroraEffect) {
        window.auroraEffect = this.controller;
      }
    }

    disconnectedCallback() {
      if (this.controller) {
        this.controller.destroy();
        if (window.auroraEffect === this.controller) {
          window.auroraEffect = null;
        }
      }
    }

    setActive(active, durationMs) {
      if (this.controller) {
        this.controller.setActive(active, durationMs);
      }
    }
  }

  if (typeof customElements !== 'undefined' && !customElements.get('aurora-background')) {
    customElements.define('aurora-background', AuroraBackgroundElement);
    if (!customElements.get('aurora-header')) {
      customElements.define('aurora-header', class extends AuroraBackgroundElement {});
    }
  }

  // ---------------------------------------------------------------------------
  // Context-Aware Hooks
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('play', (e) => {
      if (e.target && e.target.tagName === 'AUDIO') {
        window.auroraEffect?.setActive(true);
      }
    }, true);

    document.addEventListener('pause', (e) => {
      if (e.target && e.target.tagName === 'AUDIO') {
        window.auroraEffect?.setActive(false);
      }
    }, true);

    window.addEventListener('aurora:active', (e) => {
      const duration = (e.detail && e.detail.duration) || 0;
      window.auroraEffect?.setActive(true, duration);
    });

    window.addEventListener('aurora:idle', () => {
      window.auroraEffect?.setActive(false);
    });
  });

  window.AuroraController = AuroraController;
})();
