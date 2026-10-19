/**
 * Gemini-style ambient aurora.
 * Soft multi-colour ribbons of light (blue -> violet -> pink -> peach -> teal) flow along the top edge of the
 * screen, with a fainter echo along the bottom edge. Light spills from the edges, fades to pure black towards
 * the middle, breathes slowly and never fully disappears. Playing audio / events speed it up and brighten it.
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

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Gemini-style spectrum: blue -> violet -> magenta -> peach -> teal -> blue (cyclic, s in any range)
    vec3 spectrum(float s) {
      s = fract(s) * 5.0;
      vec3 c0 = vec3(0.20, 0.45, 1.00); // google blue
      vec3 c1 = vec3(0.56, 0.32, 1.00); // violet
      vec3 c2 = vec3(1.00, 0.28, 0.62); // magenta / pink
      vec3 c3 = vec3(1.00, 0.62, 0.34); // warm peach
      vec3 c4 = vec3(0.10, 0.82, 0.86); // teal
      float f = smoothstep(0.0, 1.0, fract(s));
      if (s < 1.0) return mix(c0, c1, f);
      if (s < 2.0) return mix(c1, c2, f);
      if (s < 3.0) return mix(c2, c3, f);
      if (s < 4.0) return mix(c3, c4, f);
      return mix(c4, c0, f);
    }

    // One flowing ribbon of light hugging an edge. d = distance from the edge (0 at edge).
    vec3 ribbon(float x, float d, float t, float seed, float width, float amp, float colorShift) {
      float wave =
          0.5 + 0.5 * sin(x * 3.1 + t * 0.9 + seed * 6.2831)
        + 0.5 * sin(x * 5.3 - t * 0.7 + seed * 12.7)
        + 0.25 * sin(x * 9.1 + t * 1.3 + seed * 3.3);
      float center = 0.05 + amp * wave * 0.11;
      float dist = (d - center) / width;
      float core = exp(-dist * dist);
      float halo = exp(-abs(dist) * 1.4) * 0.18;
      // colour flows horizontally and drifts over time -> spatial spectral separation
      float s = x * 0.55 + t * 0.045 + colorShift + 0.12 * sin(t * 0.3 + seed * 5.0);
      return spectrum(s) * (core + halo);
    }

    vec3 edgeLight(float x, float d, float t, float strength) {
      // layers are combined with max() (not +) so colours stay saturated instead of washing to grey
      vec3 light = ribbon(x, d, t, 0.00, 0.095, 1.00, 0.00) * 1.00;
      light = max(light, ribbon(x, d, t * 0.83 + 4.0, 0.37, 0.120, 0.80, 0.33) * 0.85);
      light = max(light, ribbon(x, d, t * 1.17 + 9.0, 0.71, 0.075, 1.15, 0.66) * 0.80);
      // light spilling from the edge itself
      float spill = exp(-d * 4.5);
      light = max(light, spectrum(x * 0.55 + t * 0.045 + 0.15) * spill * 0.70);
      return light * strength;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);
      float x = uv.x * min(aspect, 1.8) * 1.15;
      float yTop = 1.0 - uv.y;   // 0 at top edge
      float yBot = uv.y;         // 0 at bottom edge

      float t = u_time * 0.55;

      // slow breathing: never fully dark, swells now and then
      float breath = 0.78 + 0.22 * sin(u_time * 0.35) + 0.12 * smoothstep(0.6, 1.0, sin(u_time * 0.13 + 1.0));

      // vertical reach: light fades to pure black well before the middle of the screen
      float topReach = smoothstep(0.38, 0.0, yTop);
      float botReach = smoothstep(0.18, 0.0, yBot);

      vec3 light = edgeLight(x, yTop, t, 1.0) * topReach;
      light = max(light, edgeLight(x + 1.7, yBot, t * 0.9 + 20.0, 0.35) * botReach);

      light *= breath * u_intensity;

      // filmic roll-off keeps highlights luminous but never clipped
      vec3 col = 1.0 - exp(-light * 1.6);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = clamp(mix(vec3(lum), col, 1.3), 0.0, 1.0);

      // micro-dither against banding on OLED gradients
      col += (hash(gl_FragCoord.xy + u_time) - 0.5) * (1.5 / 255.0);
      col = max(col, vec3(0.0));

      float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
      gl_FragColor = vec4(col, a);
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
          intensity: 0.72,
          activeSpeed: 1.8,
          activeIntensity: 1.3,
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

      // Draw the first frame immediately so the glow is visible on load (rAF can be deferred in background panes).
      render(performance.now());
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
      const intensity = parseFloat(this.getAttribute('intensity')) || 0.72;
      const activeSpeed = parseFloat(this.getAttribute('active-speed')) || 1.8;
      const activeIntensity = parseFloat(this.getAttribute('active-intensity')) || 1.3;

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
