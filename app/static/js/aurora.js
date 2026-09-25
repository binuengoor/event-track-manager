/**
 * Aurora Fluid Light Effect
 * Hardware-accelerated WebGL ambient glow inspired by Gemini iOS ambient light.
 * Supports OLED dark environments, screen color blending, active-state reactivity,
 * battery conservation, and prefers-reduced-motion fallbacks.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // GLSL Shaders
  // ---------------------------------------------------------------------------
  const VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_intensity;
    uniform vec3 u_color1; // Electric Indigo
    uniform vec3 u_color2; // Vivid Violet
    uniform vec3 u_color3; // Deep Cyan / Teal
    uniform vec3 u_color4; // Subtle Warm Rose

    // Simplex Noise 2D helper
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

    // Screen blend mode between two colors
    vec3 blendScreen(vec3 base, vec3 blend) {
      return 1.0 - (1.0 - base) * (1.0 - blend);
    }

    void main() {
      // Normalize aspect ratio coordinates
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);
      vec2 p = vec2(uv.x * aspect, uv.y);

      // Organic wandering time variables (14s to 20s cycles)
      float t = u_time * 0.055;

      // Gentle scale oscillation between 0.90x and 1.15x
      float scalePulse = 1.0 + 0.12 * sin(t * 0.7);
      p *= scalePulse;

      // Domain warping noise passes for fluid movement
      vec2 warp1 = vec2(
        snoise(p * 0.95 + vec2(t * 0.8, -t * 0.6)),
        snoise(p * 1.15 + vec2(-t * 0.7, t * 0.9))
      );

      vec2 warp2 = vec2(
        snoise(p * 1.4 + warp1 * 1.35 + vec2(t * 0.5, t * 0.4)),
        snoise(p * 1.2 + warp1 * 1.1 + vec2(-t * 0.45, -t * 0.6))
      );

      // Radial fluid centers that wander across the top header
      float d1 = length(p - vec2(0.25 * aspect + 0.25 * sin(t * 0.9), 0.75 + 0.15 * cos(t * 0.7)) + warp2 * 0.4);
      float d2 = length(p - vec2(0.60 * aspect + 0.30 * cos(t * 0.8), 0.65 + 0.20 * sin(t * 0.6)) + warp1 * 0.4);
      float d3 = length(p - vec2(0.85 * aspect + 0.20 * sin(t * 1.1), 0.80 + 0.15 * sin(t * 0.85)) + warp2 * 0.35);
      float d4 = length(p - vec2(0.45 * aspect + 0.18 * cos(t * 1.3), 0.85 + 0.12 * cos(t * 1.0)) + warp1 * 0.3);

      // Extremely soft falloffs (Gaussian-like curve) to eliminate banding
      float b1 = smoothstep(1.3, 0.05, d1);
      float b2 = smoothstep(1.4, 0.05, d2);
      float b3 = smoothstep(1.3, 0.05, d3);
      float b4 = smoothstep(1.0, 0.05, d4);

      // Deep OLED dark base (#000000 to #030712)
      vec3 color = vec3(0.012, 0.024, 0.045);

      // Screen blend overlapping color blobs
      color = blendScreen(color, u_color1 * b1 * 0.85); // Electric Indigo
      color = blendScreen(color, u_color2 * b2 * 0.80); // Vivid Violet
      color = blendScreen(color, u_color3 * b3 * 0.70); // Deep Cyan
      color = blendScreen(color, u_color4 * b4 * 0.60); // Warm Rose Highlight

      // Top-anchored vertical feathering: high alpha near top, smooth transparency toward bottom
      float verticalFeather = smoothstep(0.0, 0.85, uv.y);
      float edgeVignette = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);

      float finalAlpha = verticalFeather * edgeVignette * u_intensity;

      gl_FragColor = vec4(color, clamp(finalAlpha, 0.0, 1.0));
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
          intensity: 0.75,
          activeSpeed: 2.2,
          activeIntensity: 1.05,
          colors: {
            indigo: [0.263, 0.220, 0.792],
            violet: [0.545, 0.231, 0.965],
            cyan: [0.024, 0.714, 0.831],
            rose: [0.957, 0.247, 0.369],
          },
        },
        options
      );

      this.isActive = false;
      this.currentSpeed = this.options.speed;
      this.targetSpeed = this.options.speed;
      this.currentIntensity = this.options.intensity;
      this.targetIntensity = this.options.intensity;

      this.virtualTime = Math.random() * 100.0;
      this.lastFrameTime = performance.now();
      this.animationFrameId = null;
      this.isDestroyed = false;

      this.initDOM();
      this.initWebGL();
      this.bindEvents();
    }

    initDOM() {
      // Look for or create canvas
      let canvas = this.container.querySelector('.aurora-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'aurora-canvas';
        this.container.appendChild(canvas);
      }
      this.canvas = canvas;

      // Look for or create CSS fallback layer
      let fallback = this.container.querySelector('.aurora-fallback');
      if (!fallback) {
        fallback = document.createElement('div');
        fallback.className = 'aurora-fallback';
        this.container.appendChild(fallback);
      }
      this.fallback = fallback;
    }

    initWebGL() {
      // Check prefers-reduced-motion first
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

      // Compile vertex shader
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VERTEX_SHADER_SOURCE);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        console.warn('Aurora: VS compilation error:', gl.getShaderInfoLog(vs));
        this.enableFallback('shader-error');
        return;
      }

      // Compile fragment shader
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, FRAGMENT_SHADER_SOURCE);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        console.warn('Aurora: FS compilation error:', gl.getShaderInfoLog(fs));
        this.enableFallback('shader-error');
        return;
      }

      // Link program
      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.warn('Aurora: Program link error:', gl.getProgramInfoLog(this.program));
        this.enableFallback('program-link-error');
        return;
      }

      gl.useProgram(this.program);

      // Quad buffer (-1 to 1)
      const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      const aPos = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      // Cache uniform locations
      this.uniforms = {
        resolution: gl.getUniformLocation(this.program, 'u_resolution'),
        time: gl.getUniformLocation(this.program, 'u_time'),
        intensity: gl.getUniformLocation(this.program, 'u_intensity'),
        color1: gl.getUniformLocation(this.program, 'u_color1'),
        color2: gl.getUniformLocation(this.program, 'u_color2'),
        color3: gl.getUniformLocation(this.program, 'u_color3'),
        color4: gl.getUniformLocation(this.program, 'u_color4'),
      };

      // Set constant colors
      const c = this.options.colors;
      gl.uniform3fv(this.uniforms.color1, c.indigo);
      gl.uniform3fv(this.uniforms.color2, c.violet);
      gl.uniform3fv(this.uniforms.color3, c.cyan);
      gl.uniform3fv(this.uniforms.color4, c.rose);

      // Initial resize & render start
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

      const rect = this.container.getBoundingClientRect();
      const width = Math.max(rect.width || window.innerWidth, 320);
      const height = Math.max(rect.height || 300, 200);

      // Battery & GPU Fillrate Guardrail: Clamp DPR to max 1.25
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

        // Smooth linear interpolation for speed and luminance transitions
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
      // 1. Efficient debounced resize
      let resizeTimeout = null;
      this._onResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.resize(), 100);
      };
      window.addEventListener('resize', this._onResize, { passive: true });

      // 2. Battery Guardrail: Freeze rendering when tab is hidden (0% CPU/GPU)
      this._onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          this.stopLoop();
        } else {
          this.startLoop();
        }
      };
      document.addEventListener('visibilitychange', this._onVisibilityChange);

      // 3. WebGL Context Loss Handling
      this._onContextLost = (e) => {
        e.preventDefault();
        this.stopLoop();
      };
      this._onContextRestored = () => {
        this.initWebGL();
      };
      this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
      this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

      // 4. Accessibility: Reduced Motion Observer
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
      const intensity = parseFloat(this.getAttribute('intensity')) || 0.75;
      const activeSpeed = parseFloat(this.getAttribute('active-speed')) || 2.2;
      const activeIntensity = parseFloat(this.getAttribute('active-intensity')) || 1.05;

      this.controller = new AuroraController(this, {
        speed,
        intensity,
        activeSpeed,
        activeIntensity,
      });

      // Register as global instance if none exists
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
    // Also define aurora-header alias for convenience
    if (!customElements.get('aurora-header')) {
      customElements.define('aurora-header', class extends AuroraBackgroundElement {});
    }
  }

  // ---------------------------------------------------------------------------
  // Automatic Context-Aware Hooking (Audio Playback & Network Live Polling)
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    // 1. Hook into Wavesurfer audio playback if present
    const checkAudioHooks = () => {
      if (window.wavesurfer) {
        window.wavesurfer.on('play', () => window.auroraEffect?.setActive(true));
        window.wavesurfer.on('pause', () => window.auroraEffect?.setActive(false));
        window.wavesurfer.on('finish', () => window.auroraEffect?.setActive(false));
      }
    };

    // 2. Hook into native HTML5 audio elements
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

    // Initial check
    setTimeout(checkAudioHooks, 500);

    // 3. Custom events for any component in the app to trigger
    window.addEventListener('aurora:active', (e) => {
      const duration = (e.detail && e.detail.duration) || 0;
      window.auroraEffect?.setActive(true, duration);
    });

    window.addEventListener('aurora:idle', () => {
      window.auroraEffect?.setActive(false);
    });
  });

  // Export class for external bundlers or ES module scripts if required
  window.AuroraController = AuroraController;
})();
