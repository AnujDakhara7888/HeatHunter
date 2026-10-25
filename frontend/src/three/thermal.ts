import * as THREE from "three";

/**
 * FLIR-style infrared material. Values are a 0..1 "relative surface warmth"
 * driven by the engine's finding (never by truth):
 *  - outside, heat escaping through a leaking wall glows warm;
 *  - inside, the same wall (and windows) read cold, like a real IR photo.
 */
export function createThermalMaterial(base: number) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uBase: { value: base },
      uSegs: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      uSegCount: { value: 0 },
      uSpots: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uSpotCount: { value: 0 },
      uStrength: { value: 0 },
      uTime: { value: 0 },
      uInside: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vWorld=w.xyz; vNormal=normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uBase; uniform vec4 uSegs[6]; uniform int uSegCount; uniform vec3 uSpots[8]; uniform int uSpotCount;
      uniform float uStrength; uniform float uTime; uniform float uInside;
      varying vec3 vWorld; varying vec3 vNormal;
      // FLIR "rainbow HC" style: deep blue → blue → cyan → green → yellow → orange → red → pink-white
      vec3 flir(float v){ v=clamp(v,0.,1.);
        vec3 c[8];
        c[0]=vec3(.02,.02,.25); c[1]=vec3(.05,.15,.75); c[2]=vec3(.0,.55,.95); c[3]=vec3(.1,.75,.35);
        c[4]=vec3(.95,.9,.1); c[5]=vec3(1.,.55,.05); c[6]=vec3(.9,.1,.1); c[7]=vec3(1.,.75,.8);
        float x=v*7.; int i=int(floor(x)); float f=fract(x);
        vec3 a=c[0], b=c[1];
        for(int k=0;k<7;k++){ if(k==i){ a=c[k]; b=c[k+1]; } }
        if(i>=7) return c[7];
        return mix(a,b,smoothstep(0.,1.,f)); }
      float hash(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
      float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        float n000=hash(i), n100=hash(i+vec3(1,0,0)), n010=hash(i+vec3(0,1,0)), n110=hash(i+vec3(1,1,0));
        float n001=hash(i+vec3(0,0,1)), n101=hash(i+vec3(1,0,1)), n011=hash(i+vec3(0,1,1)), n111=hash(i+vec3(1,1,1));
        return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z); }
      float segDist(vec2 p, vec2 a, vec2 b){ vec2 ab=b-a; float t=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-4),0.,1.); return length(p-(a+ab*t)); }
      void main(){
        float v = uBase + .06*(noise(vWorld*1.6)-.5) + .03*(noise(vWorld*5.)-.5);
        // corners and the floor junction lose a little more heat (thermal bridging)
        float edge = smoothstep(.45,0.,vWorld.y) + smoothstep(2.0,2.4,vWorld.y);
        v += mix(.06, -.08, uInside)*edge;
        float heat = 0.;
        for(int i=0;i<6;i++){ if(i>=uSegCount) break;
          float d = segDist(vWorld.xz, uSegs[i].xy, uSegs[i].zw);
          float vert = smoothstep(2.7,.5,vWorld.y)*smoothstep(-.2,.5,vWorld.y);
          heat = max(heat, exp(-d*d/.06)*vert*(.9+.1*sin(uTime*1.1+vWorld.y*2.5+vWorld.x)));
        }
        for(int i=0;i<8;i++){ if(i>=uSpotCount) break;
          vec3 q = vWorld - uSpots[i]; q.y *= .7;
          heat = max(heat, exp(-dot(q,q)/.22)*(.9+.1*sin(uTime*1.7+float(i))));
        }
        // outside: escaping heat reads warm; inside: the losing surface reads cold
        v += mix(1., -1.25, uInside)*uStrength*heat*.55;
        gl_FragColor = vec4(flir(v),1.);
      }`,
  });
}
