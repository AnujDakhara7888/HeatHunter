import * as THREE from "three";

/** Infrared-camera material. Hotspots come from the engine's finding, never from truth. */
export function createThermalMaterial(base: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: base },
      uSegs: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      uSegCount: { value: 0 },
      uSpots: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uSpotCount: { value: 0 },
      uStrength: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vWorld=w.xyz; vNormal=normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uBase; uniform vec4 uSegs[6]; uniform int uSegCount; uniform vec3 uSpots[8]; uniform int uSpotCount;
      uniform float uStrength; uniform float uTime;
      varying vec3 vWorld; varying vec3 vNormal;
      vec3 ir(float v){ v=clamp(v,0.,1.);
        vec3 c0=vec3(0.,0.,.016),c1=vec3(.173,.043,.353),c2=vec3(.478,.122,.431),c3=vec3(.82,.267,.173),c4=vec3(.984,.608,.024),c5=vec3(.988,1.,.643);
        if(v<.2)return mix(c0,c1,v/.2); if(v<.4)return mix(c1,c2,(v-.2)/.2); if(v<.6)return mix(c2,c3,(v-.4)/.2);
        if(v<.8)return mix(c3,c4,(v-.6)/.2); return mix(c4,c5,(v-.8)/.2);}
      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      float segDist(vec2 p, vec2 a, vec2 b){ vec2 ab=b-a; float t=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-4),0.,1.); return length(p-(a+ab*t)); }
      void main(){
        float v = uBase + .035*hash(floor(vWorld.xz*7.)+floor(vWorld.y*7.));
        float heat = 0.;
        for(int i=0;i<6;i++){ if(i>=uSegCount) break;
          float d = segDist(vWorld.xz, uSegs[i].xy, uSegs[i].zw);
          float vert = smoothstep(2.6,0.6,vWorld.y)*smoothstep(-.1,.4,vWorld.y);
          heat = max(heat, exp(-d*d/.05)*vert*(.85+.15*sin(uTime*1.3+vWorld.y*3.)));
        }
        for(int i=0;i<8;i++){ if(i>=uSpotCount) break;
          float d = length(vWorld - uSpots[i]);
          heat = max(heat, exp(-d*d/.18)*(.85+.15*sin(uTime*2.+float(i))));
        }
        v += uStrength*heat*.62;
        v -= .05*max(vNormal.y,0.);
        gl_FragColor = vec4(ir(v),1.);
      }`,
  });
}
