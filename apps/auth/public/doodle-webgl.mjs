import {
  doodles,
  doodleSeed,
  paletteForDay,
  doodleParameters,
} from "./doodle-spec.mjs";

const vertex = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}`;
// Original wave fields. References are linked in the private concept gallery.
const fragment = `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float seed;
uniform int mode;
uniform float dark;
uniform float colorStrength;
uniform float saturation;
uniform float iridescence;
uniform float contrast;
uniform float speed;
uniform float patternScale;
uniform vec3 accent;
uniform vec3 secondary;
uniform vec3 streakA;
uniform vec3 streakB;
uniform vec3 streakC;
out vec4 outputColour;
float line(float x,float width){float a=fwidth(x)*1.2;return 1.-smoothstep(width-a,width+a,abs(fract(x+.5)-.5));}
vec3 paper(){return mix(vec3(.965,.975,.983),vec3(.072,.092,.11),dark);}
vec3 tint(float amount){return mix(paper(),accent,amount*mix(.8,.48,dark));}
vec3 second(float amount){return mix(paper(),secondary,amount*mix(.8,.48,dark));}
vec3 spectrum(float phase){
 float a=.5+.5*sin(phase);
 float b=.5+.5*sin(phase*1.31+2.);
 return mix(mix(streakA,streakB,a),streakC,b*.7);
}
vec3 material(float amount,float phase){
 vec3 pigment=spectrum(sin(phase)*.9*iridescence+seed*6.2831853);
 return mix(tint(amount),pigment,amount*colorStrength*.38);
}
vec3 reflection(float phase,float strength){
 return mix(mix(vec3(.995,1.,1.),second(.62),dark),spectrum(sin(phase)*.9*iridescence+seed*6.2831853),min(.9,strength*colorStrength*2.));
}
void main(){
 vec2 p=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 p*=patternScale;
 float t=time*.07*speed+seed*6.2831853;
 vec3 bg=paper(),colour=bg;

 if(mode==0){
  float f=p.y*22.+sin(p.x*6.+t)*1.7+cos(p.x*3.+t*.6)*1.1;
  colour=mix(bg,material(.65,f),line(f,.016)*.65+line(f/6.,.018)*.28);
 }else if(mode<=5){
  float y=p.y+.24*sin(p.x*3.8+t)+.07*sin(p.x*7.6-t*.5);
  float phase=y*21.+.8*cos(p.x*3.-t);
  float fold=.5+.5*sin(phase),sheen=pow(.5+.5*cos(phase+.9),8.);
  colour=mix(bg,material(.65,phase),.15+.42*fold);
  colour=mix(colour,reflection(phase,.17),sheen*.5);
  if(mode==2){
   float pleat=(p.y+.23*sin(p.x*3.2+t)+.04*cos(p.x*9.-t*.6))*36.;
   float shade=.5+.5*sin(pleat+sin(p.x*4.));
   colour=mix(second(.1),material(.64,pleat),shade*.75);
   float highlight=pow(.5+.5*cos(pleat+.5),14.);
   colour=mix(colour,reflection(pleat,.14),highlight*.55);
  }else if(mode==3){
   float sweep=(p.y+.28*sin(p.x*2.7+t))*12.;
   float shine=pow(.5+.5*cos(sweep+sin(p.x*2.+t*.5)),18.);
   colour=mix(material(.16,sweep),material(.5,sweep+.6),.5+.5*sin(sweep*.65+p.x));
   colour=mix(colour,reflection(sweep,.18),shine*.6);
  }else if(mode==4){
   float other=p.y+.27*sin(p.x*3.5-t*.4)+.05*sin(p.x*8.);
   float a=.5+.5*cos(y*20.),b=.5+.5*sin(other*17.);
   colour=mix(bg,material(.72,y*20.),a*.43);colour=mix(colour,material(.66,other*17.),b*.36);
   colour=mix(colour,reflection(y*20.+other*17.,.13),pow(a*b,4.)*.26);
  }else if(mode==5){
   colour=mix(bg,tint(.3),.12);
   for(int i=0;i<3;i++){
    float fi=float(i),center=.23*sin(p.x*3.1+t+fi*2.0944);
    float width=.065+.018*cos(p.x*4.+t+fi);
    float band=1.-smoothstep(.4,1.,abs(p.y-center)/width);
    vec3 ribbon=mix(material(.82,(p.y-center)*22.),material(.72,(p.y-center)*22.+.7),fi*.4);
    float shading=.65+.35*sin((p.y-center)*22.+p.x*.4+fi);
    colour=mix(colour,mix(bg,ribbon,shading),band*.8);

   }
  }
 }else{
  vec2 q=p*5.;q+=.3*vec2(sin(q.y+t),cos(q.x-t*.7));
  float a=sin(q.x+sin(q.y*1.3+t*.5)),b=cos(q.y+cos(q.x*1.1-t*.7));
  float c=pow(1.-abs(a*b),10.);
  float d=pow(1.-abs(sin(q.x*.8-q.y+t*.4)*cos(q.y*.7+q.x*.6)),12.);
  float strength=.55;
  if(mode==7){
   q=p*3.8+.35*vec2(sin(p.y*3.+t),cos(p.x*2.8-t*.5));
   a=sin(q.x+sin(q.y+t*.4));b=cos(q.y+sin(q.x-t*.5));
   c=pow(1.-abs(a*b),14.);d=pow(1.-abs(sin(q.x+q.y)*cos(q.y*.6-t*.2)),10.);strength=.46;
  }else if(mode==8){
   float r1=length(p-vec2(-.38,.12)),r2=length(p-vec2(.42,-.18));
   a=sin(r1*29.-t);b=sin(r2*25.-t*.7);
   c=pow(1.-abs(a*b),10.);d=pow(1.-abs(sin(r1*17.+r2*15.-t*.5)),12.);strength=.58;
  }else if(mode==9){
   q=p*4.5+vec2(t*.12,-t*.06);q+=.5*vec2(sin(q.y*.8-t*.25),cos(q.x*1.1+t*.4));
   a=sin(q.x*.7+sin(q.y+t*.4));b=cos(q.y*.9+cos(q.x-t*.2));
   c=pow(1.-abs(a*b),12.);d=pow(1.-abs(sin(q.x+q.y*.8)*cos(q.y-q.x*.5)),12.);strength=.58;
  }else if(mode==10){
   q=p*7.+.4*vec2(sin(p.y*4.+t*.4),cos(p.x*3.-t*.3));
   a=sin(q.x+sin(q.y*.8+t*.3));b=cos(q.y+cos(q.x*.9-t*.4));
   c=pow(1.-abs(a*b),5.);d=pow(1.-abs(sin(q.x*.7-q.y)*cos(q.y*.9+q.x)),7.);strength=.74;
  }
  vec3 water=mix(material(strength,a-b),material(strength*.72,a+b),.3+.15*sin(q.x*.3+q.y*.2));
  vec3 light=reflection(a-b,.12+.12*pow(c*d,3.));
  colour=mix(bg,water,.82);colour=mix(colour,light,clamp(c*.55+d*.35,0.,.8));
 }
 float luma=dot(colour,vec3(.2126,.7152,.0722));
 colour=mix(vec3(luma),colour,saturation);
 colour=bg+(colour-bg)*contrast;
 outputColour=vec4(clamp(colour,0.,1.),1.);
}`;

export function startDoodle(
  canvas,
  {
    id,
    day,
    dark = false,
    motion = true,
    settings = {},
    onFallback = () => {},
  },
) {
  let gl;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
      depth: false,
      stencil: false,
      preserveDrawingBuffer: !motion,
    });
  } catch {}
  if (!gl) return { supported: false, stop() {} };
  let disposed = false,
    frame = 0,
    last = 0,
    visible = true;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw Error("Shader compile failed");
    }
    return shader;
  };
  let vs, fs, program, buffer;
  try {
    vs = compile(gl.VERTEX_SHADER, vertex);
    fs = compile(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error("Shader link failed");
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  } catch {
    if (program) gl.deleteProgram(program);
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { supported: false, stop() {} };
  }
  const location = (name) => gl.getUniformLocation(program, name),
    uResolution = location("resolution"),
    uTime = location("time");
  gl.uniform1i(
    location("mode"),
    doodles.find((item) => item.id === id)?.mode || 0,
  );
  gl.uniform1f(location("seed"), doodleSeed(id, day));
  gl.uniform1f(location("dark"), dark ? 1 : 0);
  const applyPalette = (paletteDay) => {
    const palette = paletteForDay(paletteDay);
    gl.uniform3fv(location("accent"), palette.accent);
    gl.uniform3fv(location("secondary"), palette.secondary);
    gl.uniform3fv(location("streakA"), palette.streaks[0]);
    gl.uniform3fv(location("streakB"), palette.streaks[1]);
    gl.uniform3fv(location("streakC"), palette.streaks[2]);
  };
  function applySettings(value) {
    for (const [key, n] of Object.entries(doodleParameters(value)))
      gl.uniform1f(
        location(
          key === "color"
            ? "colorStrength"
            : key === "scale"
              ? "patternScale"
              : key,
        ),
        n,
      );
  }
  applySettings(settings);
  applyPalette(day);
  const start = performance.now();
  function draw(now) {
    if (disposed) return;
    const box = canvas.getBoundingClientRect(),
      ratio = Math.min(
        devicePixelRatio || 1,
        1.25,
        Math.sqrt(1_200_000 / Math.max(1, box.width * box.height)),
      );
    const width = Math.max(1, Math.round(box.width * ratio)),
      height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(uResolution, width, height);
    gl.uniform1f(uTime, motion ? (now - start) / 1000 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function tick(now) {
    if (disposed || !visible || document.hidden) return;
    if (now - last >= 1000 / 24) {
      draw(now);
      last = now;
    }
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    cancelAnimationFrame(frame);
    if (!disposed && visible && !document.hidden) {
      if (motion) frame = requestAnimationFrame(tick);
      else draw(start);
    }
  }
  const resize = new ResizeObserver(() => {
    if (visible && !document.hidden) draw(performance.now());
  });
  resize.observe(canvas);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    resume();
  });
  intersection.observe(canvas);
  const onVisibility = () => resume();
  document.addEventListener("visibilitychange", onVisibility);
  function stop() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", lost);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  function lost(event) {
    event.preventDefault();
    stop();
    onFallback();
  }
  canvas.addEventListener("webglcontextlost", lost);
  draw(start);
  resume();
  return {
    supported: true,
    stop,
    setSettings(value) {
      applySettings(value);
      draw(performance.now());
    },
    setTheme(nextId, nextDay, nextDark, nextSettings = {}) {
      if (disposed) return;
      gl.uniform1i(
        location("mode"),
        doodles.find((item) => item.id === nextId)?.mode || 0,
      );
      gl.uniform1f(location("seed"), doodleSeed(nextId, nextDay));
      gl.uniform1f(location("dark"), nextDark ? 1 : 0);
      applySettings(nextSettings);
      applyPalette(nextDay);
      draw(start);
    },
  };
}
