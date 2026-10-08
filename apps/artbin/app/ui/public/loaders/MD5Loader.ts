/**
 * MD5Loader - Three.js loader for Doom 3 / idTech 4 MD5 skeletal mesh format
 *
 * Supports:
 * - .md5mesh files (skeletal mesh with joints and weighted vertices)
 * - .md5anim files (skeletal animation data)
 *
 * Usage:
 *   const loader = new MD5Loader();
 *   const { mesh, skeleton } = await loader.loadMesh(meshUrl, textureUrl);
 *   const clip = await loader.loadAnim(animUrl, skeleton);
 */

import * as THREE from "three";

interface MD5Joint {
  name: string;
  parent: number;
  position: [number, number, number];
  orientation: [number, number, number, number]; // quaternion xyzw
}

interface MD5Vertex {
  index: number;
  uv: [number, number];
  startWeight: number;
  countWeight: number;
}

interface MD5Triangle {
  indices: [number, number, number];
}

interface MD5Weight {
  index: number;
  joint: number;
  bias: number;
  position: [number, number, number];
}

interface MD5MeshData {
  shader: string;
  vertices: MD5Vertex[];
  triangles: MD5Triangle[];
  weights: MD5Weight[];
}

interface MD5MeshFile {
  joints: MD5Joint[];
  meshes: MD5MeshData[];
}

interface MD5AnimHierarchy {
  name: string;
  parent: number;
  flags: number;
  startIndex: number;
}

interface MD5AnimBaseFrame {
  position: [number, number, number];
  orientation: [number, number, number]; // xyz, w computed
}

interface MD5AnimFrame {
  index: number;
  components: number[];
}

interface MD5AnimFile {
  frameRate: number;
  numFrames: number;
  hierarchy: MD5AnimHierarchy[];
  baseFrame: MD5AnimBaseFrame[];
  frames: MD5AnimFrame[];
}

/**
 * Compute quaternion W component from XYZ
 * MD5 stores quaternions as xyz with w computed to make unit quaternion
 */
function computeQuaternionW(x: number, y: number, z: number): number {
  const t = 1.0 - x * x - y * y - z * z;
  return t < 0 ? 0 : -Math.sqrt(t);
}

// oxlint-disable-next-line typescript/no-extraneous-class -- Parser methods share the imported loader interface.
class MD5Parser {
  static parseMesh(source: string): MD5MeshFile {
    const joints: MD5Joint[] = [];
    const meshes: MD5MeshData[] = [];

    const jointsMatch = source.match(/joints\s*\{([^}]+)\}/);
    if (jointsMatch) {
      const jointsBlock = jointsMatch[1];
      const jointRegex =
        /"([^"]+)"\s+(-?\d+)\s+\(\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*\)\s+\(\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*\)/g;

      let match;
      while ((match = jointRegex.exec(jointsBlock)) !== null) {
        const x = parseFloat(match[6]);
        const y = parseFloat(match[7]);
        const z = parseFloat(match[8]);
        const w = computeQuaternionW(x, y, z);

        joints.push({
          name: match[1],
          parent: parseInt(match[2], 10),
          position: [
            parseFloat(match[3]),
            parseFloat(match[4]),
            parseFloat(match[5]),
          ],
          orientation: [x, y, z, w],
        });
      }
    }

    const meshRegex = /mesh\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
    let meshMatch;
    while ((meshMatch = meshRegex.exec(source)) !== null) {
      const meshBlock = meshMatch[1];

      const shaderMatch = meshBlock.match(/shader\s+"([^"]+)"/);
      const shader = shaderMatch ? shaderMatch[1] : "";

      const vertices: MD5Vertex[] = [];
      const vertRegex =
        /vert\s+(\d+)\s+\(\s*([^\s]+)\s+([^\s]+)\s*\)\s+(\d+)\s+(\d+)/g;
      let vertMatch;
      while ((vertMatch = vertRegex.exec(meshBlock)) !== null) {
        vertices.push({
          index: parseInt(vertMatch[1], 10),
          uv: [parseFloat(vertMatch[2]), parseFloat(vertMatch[3])],
          startWeight: parseInt(vertMatch[4], 10),
          countWeight: parseInt(vertMatch[5], 10),
        });
      }

      const triangles: MD5Triangle[] = [];
      const triRegex = /tri\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)/g;
      let triMatch;
      while ((triMatch = triRegex.exec(meshBlock)) !== null) {
        triangles.push({
          indices: [
            parseInt(triMatch[1], 10),
            parseInt(triMatch[2], 10),
            parseInt(triMatch[3], 10),
          ],
        });
      }

      const weights: MD5Weight[] = [];
      const weightRegex =
        /weight\s+(\d+)\s+(\d+)\s+([^\s]+)\s+\(\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*\)/g;
      let weightMatch;
      while ((weightMatch = weightRegex.exec(meshBlock)) !== null) {
        weights.push({
          index: parseInt(weightMatch[1], 10),
          joint: parseInt(weightMatch[2], 10),
          bias: parseFloat(weightMatch[3]),
          position: [
            parseFloat(weightMatch[4]),
            parseFloat(weightMatch[5]),
            parseFloat(weightMatch[6]),
          ],
        });
      }

      meshes.push({ shader, vertices, triangles, weights });
    }

    return { joints, meshes };
  }

  static parseAnim(source: string): MD5AnimFile {
    const frameRateMatch = source.match(/frameRate\s+(\d+)/);
    const frameRate = frameRateMatch ? parseInt(frameRateMatch[1], 10) : 24;

    const numFramesMatch = source.match(/numFrames\s+(\d+)/);
    const numFrames = numFramesMatch ? parseInt(numFramesMatch[1], 10) : 0;

    const hierarchy: MD5AnimHierarchy[] = [];
    const hierMatch = source.match(/hierarchy\s*\{([^}]+)\}/);
    if (hierMatch) {
      const hierRegex = /"([^"]+)"\s+(-?\d+)\s+(\d+)\s+(\d+)/g;
      let match;
      while ((match = hierRegex.exec(hierMatch[1])) !== null) {
        hierarchy.push({
          name: match[1],
          parent: parseInt(match[2], 10),
          flags: parseInt(match[3], 10),
          startIndex: parseInt(match[4], 10),
        });
      }
    }

    const baseFrame: MD5AnimBaseFrame[] = [];
    const baseMatch = source.match(/baseframe\s*\{([^}]+)\}/);
    if (baseMatch) {
      const baseRegex =
        /\(\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*\)\s+\(\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*\)/g;
      let match;
      while ((match = baseRegex.exec(baseMatch[1])) !== null) {
        baseFrame.push({
          position: [
            parseFloat(match[1]),
            parseFloat(match[2]),
            parseFloat(match[3]),
          ],
          orientation: [
            parseFloat(match[4]),
            parseFloat(match[5]),
            parseFloat(match[6]),
          ],
        });
      }
    }

    const frames: MD5AnimFrame[] = [];
    const frameRegex = /frame\s+(\d+)\s*\{([^}]+)\}/g;
    let frameMatch;
    while ((frameMatch = frameRegex.exec(source)) !== null) {
      const index = parseInt(frameMatch[1], 10);
      const componentsStr = frameMatch[2].trim();
      const components = componentsStr
        .split(/\s+/)
        .filter((s) => s.length > 0)
        .map(parseFloat);
      frames.push({ index, components });
    }

    return { frameRate, numFrames, hierarchy, baseFrame, frames };
  }
}

export interface MD5LoadResult {
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
}

export class MD5Loader {
  /**
   * Load an MD5 mesh file and create a Three.js SkinnedMesh
   */
  async loadMesh(url: string, textureUrl?: string): Promise<MD5LoadResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load MD5 mesh: ${response.statusText}`);
    }

    const source = await response.text();
    const data = MD5Parser.parseMesh(source);

    return this.buildMesh(data, textureUrl);
  }

  /**
   * Load an MD5 animation file and create a Three.js AnimationClip
   */
  async loadAnim(
    url: string,
    skeleton: THREE.Skeleton,
  ): Promise<THREE.AnimationClip> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load MD5 anim: ${response.statusText}`);
    }

    const source = await response.text();
    const data = MD5Parser.parseAnim(source);

    // Extract animation name from URL
    const name = url.split("/").pop()?.replace(".md5anim", "") || "animation";

    return this.buildAnimationClip(data, skeleton, name);
  }

  /**
   * Build a Three.js SkinnedMesh from parsed MD5 mesh data
   */
  private buildMesh(data: MD5MeshFile, textureUrl?: string): MD5LoadResult {
    const bones: THREE.Bone[] = [];
    for (let i = 0; i < data.joints.length; i++) {
      const joint = data.joints[i];
      const bone = new THREE.Bone();
      bone.name = joint.name;
      bones.push(bone);
    }

    for (let i = 0; i < data.joints.length; i++) {
      const joint = data.joints[i];
      if (joint.parent >= 0 && joint.parent < bones.length) {
        bones[joint.parent].add(bones[i]);
      }
    }

    for (let i = 0; i < data.joints.length; i++) {
      const joint = data.joints[i];
      const bone = bones[i];

      if (joint.parent < 0) {
        // Root bone - use world position
        bone.position.set(
          joint.position[0],
          joint.position[1],
          joint.position[2],
        );
        bone.quaternion.set(
          joint.orientation[0],
          joint.orientation[1],
          joint.orientation[2],
          joint.orientation[3],
        );
      } else {
        // Child bone - compute local transform
        const parentJoint = data.joints[joint.parent];

        // Get parent's world transform
        const parentPos = new THREE.Vector3(
          parentJoint.position[0],
          parentJoint.position[1],
          parentJoint.position[2],
        );
        const parentQuat = new THREE.Quaternion(
          parentJoint.orientation[0],
          parentJoint.orientation[1],
          parentJoint.orientation[2],
          parentJoint.orientation[3],
        );

        // Compute local position
        const worldPos = new THREE.Vector3(
          joint.position[0],
          joint.position[1],
          joint.position[2],
        );
        const localPos = worldPos.clone().sub(parentPos);
        localPos.applyQuaternion(parentQuat.clone().invert());
        bone.position.copy(localPos);

        // Compute local rotation
        const worldQuat = new THREE.Quaternion(
          joint.orientation[0],
          joint.orientation[1],
          joint.orientation[2],
          joint.orientation[3],
        );
        const localQuat = parentQuat.clone().invert().multiply(worldQuat);
        bone.quaternion.copy(localQuat);
      }
    }

    const skeleton = new THREE.Skeleton(bones);

    // Combine all meshes into one geometry
    const allPositions: number[] = [];
    const allNormals: number[] = [];
    const allUvs: number[] = [];
    const allIndices: number[] = [];
    const allSkinIndices: number[] = [];
    const allSkinWeights: number[] = [];

    let vertexOffset = 0;

    for (const meshData of data.meshes) {
      for (const vertex of meshData.vertices) {
        const pos = new THREE.Vector3(0, 0, 0);

        // Collect skin weights for this vertex (up to 4)
        const skinJoints: number[] = [];
        const skinWeights: number[] = [];

        for (let w = 0; w < vertex.countWeight; w++) {
          const weight = meshData.weights[vertex.startWeight + w];
          const joint = data.joints[weight.joint];

          const jointQuat = new THREE.Quaternion(
            joint.orientation[0],
            joint.orientation[1],
            joint.orientation[2],
            joint.orientation[3],
          );
          const jointPos = new THREE.Vector3(
            joint.position[0],
            joint.position[1],
            joint.position[2],
          );

          const weightPos = new THREE.Vector3(
            weight.position[0],
            weight.position[1],
            weight.position[2],
          );
          weightPos.applyQuaternion(jointQuat);
          weightPos.add(jointPos);
          weightPos.multiplyScalar(weight.bias);

          pos.add(weightPos);

          skinJoints.push(weight.joint);
          skinWeights.push(weight.bias);
        }

        allPositions.push(pos.x, pos.y, pos.z);
        allNormals.push(0, 1, 0); // Will compute proper normals later
        allUvs.push(vertex.uv[0], 1 - vertex.uv[1]); // Flip V coordinate

        // Pad to 4 weights
        while (skinJoints.length < 4) {
          skinJoints.push(0);
          skinWeights.push(0);
        }

        // Normalize weights
        const totalWeight = skinWeights.reduce((a, b) => a + b, 0);
        if (totalWeight > 0) {
          for (let i = 0; i < 4; i++) {
            skinWeights[i] /= totalWeight;
          }
        }

        allSkinIndices.push(
          skinJoints[0],
          skinJoints[1],
          skinJoints[2],
          skinJoints[3],
        );
        allSkinWeights.push(
          skinWeights[0],
          skinWeights[1],
          skinWeights[2],
          skinWeights[3],
        );
      }

      // Add triangles with offset
      for (const tri of meshData.triangles) {
        allIndices.push(
          tri.indices[0] + vertexOffset,
          tri.indices[2] + vertexOffset, // Flip winding order
          tri.indices[1] + vertexOffset,
        );
      }

      vertexOffset += meshData.vertices.length;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(allPositions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(allNormals, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(allUvs, 2));
    geometry.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(allSkinIndices, 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(allSkinWeights, 4),
    );
    geometry.setIndex(allIndices);

    geometry.computeVertexNormals();

    let material: THREE.Material;
    if (textureUrl) {
      const texture = new THREE.TextureLoader().load(textureUrl);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshLambertMaterial({ map: texture });
    } else {
      material = new THREE.MeshLambertMaterial({ color: 0x888888 });
    }

    const mesh = new THREE.SkinnedMesh(geometry, material);

    // Find root bones and add to mesh
    for (let i = 0; i < data.joints.length; i++) {
      if (data.joints[i].parent < 0) {
        mesh.add(bones[i]);
      }
    }

    mesh.bind(skeleton);

    return { mesh, skeleton };
  }

  /**
   * Build a Three.js AnimationClip from parsed MD5 animation data
   */
  private buildAnimationClip(
    data: MD5AnimFile,
    skeleton: THREE.Skeleton,
    name: string,
  ): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = [];
    const duration = data.numFrames / data.frameRate;

    // For each joint, create position and quaternion tracks
    for (let jointIdx = 0; jointIdx < data.hierarchy.length; jointIdx++) {
      const hier = data.hierarchy[jointIdx];
      const bone = skeleton.bones.find((b) => b.name === hier.name);
      if (!bone) continue;

      const times: number[] = [];
      const positions: number[] = [];
      const quaternions: number[] = [];

      for (let frameIdx = 0; frameIdx < data.frames.length; frameIdx++) {
        const frame = data.frames[frameIdx];
        const time = frameIdx / data.frameRate;
        times.push(time);

        const baseJoint = data.baseFrame[jointIdx];
        let px = baseJoint.position[0];
        let py = baseJoint.position[1];
        let pz = baseJoint.position[2];
        let qx = baseJoint.orientation[0];
        let qy = baseJoint.orientation[1];
        let qz = baseJoint.orientation[2];

        let componentIdx = hier.startIndex;
        const flags = hier.flags;

        if (flags & 1) px = frame.components[componentIdx++];
        if (flags & 2) py = frame.components[componentIdx++];
        if (flags & 4) pz = frame.components[componentIdx++];
        if (flags & 8) qx = frame.components[componentIdx++];
        if (flags & 16) qy = frame.components[componentIdx++];
        if (flags & 32) qz = frame.components[componentIdx++];

        const qw = computeQuaternionW(qx, qy, qz);

        // Convert world transform to local transform
        if (hier.parent >= 0) {
          const parentHier = data.hierarchy[hier.parent];
          const parentBase = data.baseFrame[hier.parent];

          let ppx = parentBase.position[0];
          let ppy = parentBase.position[1];
          let ppz = parentBase.position[2];
          let pqx = parentBase.orientation[0];
          let pqy = parentBase.orientation[1];
          let pqz = parentBase.orientation[2];

          let pCompIdx = parentHier.startIndex;
          const pFlags = parentHier.flags;

          if (pFlags & 1) ppx = frame.components[pCompIdx++];
          if (pFlags & 2) ppy = frame.components[pCompIdx++];
          if (pFlags & 4) ppz = frame.components[pCompIdx++];
          if (pFlags & 8) pqx = frame.components[pCompIdx++];
          if (pFlags & 16) pqy = frame.components[pCompIdx++];
          if (pFlags & 32) pqz = frame.components[pCompIdx++];

          const pqw = computeQuaternionW(pqx, pqy, pqz);

          const parentQuat = new THREE.Quaternion(pqx, pqy, pqz, pqw);
          const parentPos = new THREE.Vector3(ppx, ppy, ppz);
          const worldPos = new THREE.Vector3(px, py, pz);
          const localPos = worldPos.clone().sub(parentPos);
          localPos.applyQuaternion(parentQuat.clone().invert());

          const worldQuat = new THREE.Quaternion(qx, qy, qz, qw);
          const localQuat = parentQuat.clone().invert().multiply(worldQuat);

          positions.push(localPos.x, localPos.y, localPos.z);
          quaternions.push(localQuat.x, localQuat.y, localQuat.z, localQuat.w);
        } else {
          // Root bone - world transform is local transform
          positions.push(px, py, pz);
          quaternions.push(qx, qy, qz, qw);
        }
      }

      const boneName = bone.name;
      tracks.push(
        new THREE.VectorKeyframeTrack(`${boneName}.position`, times, positions),
      );
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${boneName}.quaternion`,
          times,
          quaternions,
        ),
      );
    }

    return new THREE.AnimationClip(name, duration, tracks);
  }
}
