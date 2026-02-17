import { useEffect, useRef, useState } from 'react';

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 centered = uv - 0.5;
  centered.x *= u_resolution.x / u_resolution.y;
  float radius = length(centered);

  float t = u_time * 0.08;
  float phaseA = sin(t * 1.17);
  float phaseB = cos(t * 0.94);
  float phaseC = sin(t * 0.73 + 1.3);

  vec2 warp = vec2(
    noise(uv * 3.7 + vec2(phaseA, phaseB)) - 0.5,
    noise(uv * 4.1 + vec2(phaseC, -phaseA)) - 0.5
  );

  float cloud = fbm(uv * vec2(4.8, 4.0) + warp * 0.42);
  float blockBase = noise(floor(uv * vec2(96.0, 72.0)) * 0.4 + warp * 0.2);
  float blockPulse = 0.5 + 0.5 * sin(t * 5.6 + blockBase * 6.2831);
  float block = mix(blockBase, blockPulse, 0.26);
  vec2 grainCell = floor(uv * vec2(320.0, 220.0));
  float grain = fract(sin(dot(grainCell, vec2(12.9898, 78.233)) + t * 15.0) * 43758.5453123);
  float scan = sin(uv.y * 760.0 + t * 18.0) * 0.014;

  vec3 baseA = vec3(0.07, 0.09, 0.12);
  vec3 baseB = vec3(0.16, 0.20, 0.27);
  vec3 color = mix(baseA, baseB, cloud);
  color += vec3(0.10, 0.14, 0.20) * block * 0.35;
  color += (grain - 0.5) * 0.17;
  color += scan;

  float glow = smoothstep(0.68, 0.0, radius) * 0.22;
  float edgeFalloff = smoothstep(0.54, 0.93, radius);
  color += vec3(0.07, 0.10, 0.16) * glow;
  color *= 1.0 - edgeFalloff * 0.48;

  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) {
      gl.deleteShader(vertexShader);
    }
    if (fragmentShader) {
      gl.deleteShader(fragmentShader);
    }
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function UntunedStaticDisc() {
  const canvasRef = useRef(null);
  const [hasWebgl, setHasWebgl] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    });

    if (!gl) {
      setHasWebgl(false);
      return undefined;
    }

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) {
      setHasWebgl(false);
      return undefined;
    }

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    if (positionLocation < 0 || !resolutionLocation || !timeLocation) {
      setHasWebgl(false);
      gl.deleteProgram(program);
      return undefined;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      setHasWebgl(false);
      gl.deleteProgram(program);
      return undefined;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    let rafId = 0;
    let resizeObserver = null;
    let isActive = true;
    const startedAt = performance.now();
    const maxDpr = 2;

    const syncCanvasSize = () => {
      if (!isActive) {
        return;
      }
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    };

    const render = (now) => {
      if (!isActive) {
        return;
      }
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, (now - startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = window.requestAnimationFrame(render);
    };

    syncCanvasSize();
    rafId = window.requestAnimationFrame(render);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => syncCanvasSize());
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', syncCanvasSize);
    }

    return () => {
      isActive = false;
      window.cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', syncCanvasSize);
      }
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <span className="disc-untuned-static" aria-hidden="true">
      {hasWebgl ? <canvas ref={canvasRef} className="disc-untuned-shader" /> : null}
    </span>
  );
}

export default UntunedStaticDisc;
