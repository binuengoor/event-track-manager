/**
 * Google Gemini Aurora Fluid Light Effect
 * Authentic Google Gemini signature ambient glow (iOS, Android & Web).
 * Spatially separated spectral waves:
 * - Electric Blue & Vivid Cyan (Left to Center)
 * - Radiant Violet & Deep Purple (Center)
 * - Neon Pink & Warm Amber Crest (Right)
 * Luminous high-saturation screen blending, liquid simplex domain warping,
 * and seamless feathering into pure OLED black (#000000).
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
      
      float x = uv.x;
      float y = 1.0 - uv.y; // 0.0 at top, 1.0 at bottom

      // Slow celestial cycle
      float t = u_time * 0.038;

      // Domain warping for organic liquid silk waves
      vec2 warp = vec2(
        snoise(vec2(x * 1.6 + t * 0.22, y * 2.0 - t * 0.16)),
        snoise(vec2(x * 1.9 - t * 0.18, y * 1.7 + t * 0.20))
      ) * 0.09;

      float xw = x + warp.x;
      float yw = y + warp.y;

      // Google Gemini Signature Colors (High Saturation & Vibrancy)
      vec3 colBlue   = vec3(0.10, 0.46, 0.98); // Electric Azure Blue #1a75fa
      vec3 colCyan   = vec3(0.00, 0.88, 0.96); // Vivid Cyan Aqua #00e0f5
      vec3 colViolet = vec3(0.60, 0.16, 0.98); // Rich Electric Violet #9929fa
      vec3 colPink   = vec3(1.00, 0.18, 0.52); // Luminous Neon Rose #ff2e85
      vec3 colAmber  = vec3(1.00, 0.65, 0.15); // Golden Core Accent #ffa626

      // Spatial distribution across the viewport width:
      // Left is Blue & Cyan, Center is Violet, Right is Pink & Amber
      float shift = sin(t * 0.4) * 0.12;
      float wCyan   = smoothstep(0.55 + shift, 0.05 + shift, xw);
      float wBlue   = smoothstep(0.05 + shift, 0.35 + shift, xw) * smoothstep(0.70 + shift, 0.35 + shift, xw);
      float wViolet = smoothstep(0.25 + shift, 0.55 + shift, xw) * smoothstep(0.85 + shift, 0.55 + shift, xw);
      float wPink   = smoothstep(0.45 + shift, 0.95 + shift, xw);

      // Undulating Wave Heights
      float h1 = 0.07 + 0.08 * sin(xw * 2.8 + t * 0.65) + 0.04 * cos(xw * 5.2 - t * 0.45);
      float h2 = 0.12 + 0.09 * cos(xw * 2.4 - t * 0.55) + 0.05 * sin(xw * 4.8 + t * 0.40);
      float h3 = 0.05 + 0.07 * sin(xw * 3.4 + t * 0.75 + 1.6) + 0.04 * cos(xw * 6.0 - t * 0.50);

      // Gaussian Energy Profiles for each wave
      float d1 = abs(yw - h1);
      float d2 = abs(yw - h2);
      float d3 = abs(yw - h3);

      float e1 = exp(-d1 * 9.5) * 1.35 + exp(-d1 * 2.8) * 0.55;
      float e2 = exp(-d2 * 8.5) * 1.25 + exp(-d2 * 2.4) * 0.50;
      float e3 = exp(-d3 * 10.0) * 1.30 + exp(-d3 * 3.0) * 0.45;

      // Soft ambient roof glow across the top navigation bar
      float ceilingBleed = exp(-y * 5.5) * 0.65;

      // Synthesize spatially coherent spectral light
      vec3 light = colCyan   * (e1 * wCyan * 1.3 + ceilingBleed * wCyan * 0.45)
                 + colBlue   * (e1 * wBlue * 1.2 + e2 * wBlue * 0.7)
                 + colViolet * (e2 * wViolet * 1.35 + ceilingBleed * wViolet * 0.40)
                 + colPink   * (e3 * wPink * 1.45 + e2 * wPink * 0.6);

      // Subtle warm amber highlight at pink crest
      float pinkCrest = e3 * wPink * 0.6;
      light += colAmber * pinkCrest;

      // Filmic tone map to maintain deep color saturation at high brightness
      // Soft knee avoids washing out colors into flat white
      vec3 toneMapped = light / (1.0 + light * 0.22);

      // Top 32% anchoring: Dissolves into pure pitch black (#000000)
      float verticalDissipation = smoothstep(0.34, 0.01, y);
      verticalDissipation = pow(verticalDissipation, 1.30);

      vec3 finalColor = toneMapped * verticalDissipation * u_intensity;

      // Micro-dither
      float dither = (hash(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
      finalColor = max(vec3(0.0), finalColor + dither);

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
          intensity: 1.05,
          activeSpeed: 2.3,
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
      const intensity = parseFloat(this.getAttribute('intensity')) || 1.05;
      const activeSpeed = parseFloat(this.getAttribute('active-speed')) || 2.3;
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
