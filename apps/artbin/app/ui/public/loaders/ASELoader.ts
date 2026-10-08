/**
 * ASELoader - Three.js loader for 3D Studio Max ASCII Scene Export format
 *
 * Supports:
 * - .ase files (static meshes with materials and UVs)
 *
 * Used in Doom 3, Quake 4, and other idTech 4 engine games.
 *
 * Usage:
 *   const loader = new ASELoader();
 *   const mesh = await loader.load(url, textureUrl);
 */

import * as THREE from "three";

// Helper to transform from ASE coords (Z-up) to Three.js coords (Y-up)
function transformCoord(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [x, z, -y];
}

interface ASEVertex {
  x: number;
  y: number;
  z: number;
}

interface ASEFace {
  a: number;
  b: number;
  c: number;
  materialId: number;
}

interface ASETexVertex {
  u: number;
  v: number;
}

interface ASETexFace {
  a: number;
  b: number;
  c: number;
}

interface ASENormal {
  x: number;
  y: number;
  z: number;
}

interface ASEFaceNormals {
  face: ASENormal;
  vertices: ASENormal[];
}

interface ASEMesh {
  name: string;
  vertices: ASEVertex[];
  faces: ASEFace[];
  texVertices: ASETexVertex[];
  texFaces: ASETexFace[];
  normals: ASEFaceNormals[];
}

interface ASEMaterial {
  name: string;
  diffuseMap?: string;
  ambient: [number, number, number];
  diffuse: [number, number, number];
  specular: [number, number, number];
}

interface ASEFile {
  meshes: ASEMesh[];
  materials: ASEMaterial[];
}

// oxlint-disable-next-line typescript/no-extraneous-class -- Parser methods share the imported loader interface.
class ASEParser {
  static parse(source: string): ASEFile {
    const meshes: ASEMesh[] = [];
    const materials: ASEMaterial[] = [];

    // Parse materials
    const materialListMatch = source.match(
      /\*MATERIAL_LIST\s*\{([\s\S]*?)\n\}/,
    );
    if (materialListMatch) {
      const materialBlocks = this.extractBlocks(
        materialListMatch[1],
        "*MATERIAL ",
      );
      for (const block of materialBlocks) {
        const material = this.parseMaterial(block);
        if (material) {
          materials.push(material);
        }
      }
    }

    // Parse geometry objects
    const geomBlocks = this.extractBlocks(source, "*GEOMOBJECT");
    for (const block of geomBlocks) {
      const mesh = this.parseGeomObject(block);
      if (mesh) {
        meshes.push(mesh);
      }
    }

    return { meshes, materials };
  }

  private static extractBlocks(source: string, tag: string): string[] {
    const blocks: string[] = [];
    let searchStart = 0;

    while (true) {
      const tagIndex = source.indexOf(tag, searchStart);
      if (tagIndex === -1) break;

      // Find the opening brace
      const braceStart = source.indexOf("{", tagIndex);
      if (braceStart === -1) break;

      // Find matching closing brace
      let depth = 1;
      let i = braceStart + 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }

      if (depth === 0) {
        blocks.push(source.substring(tagIndex, i));
      }

      searchStart = i;
    }

    return blocks;
  }

  private static parseMaterial(block: string): ASEMaterial | null {
    const nameMatch = block.match(/\*MATERIAL_NAME\s+"([^"]*)"/);
    const ambientMatch = block.match(
      /\*MATERIAL_AMBIENT\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/,
    );
    const diffuseMatch = block.match(
      /\*MATERIAL_DIFFUSE\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/,
    );
    const specularMatch = block.match(
      /\*MATERIAL_SPECULAR\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/,
    );
    const bitmapMatch = block.match(/\*BITMAP\s+"([^"]*)"/);

    return {
      name: nameMatch ? nameMatch[1] : "",
      diffuseMap: bitmapMatch ? bitmapMatch[1] : undefined,
      ambient: ambientMatch
        ? [
            parseFloat(ambientMatch[1]),
            parseFloat(ambientMatch[2]),
            parseFloat(ambientMatch[3]),
          ]
        : [0, 0, 0],
      diffuse: diffuseMatch
        ? [
            parseFloat(diffuseMatch[1]),
            parseFloat(diffuseMatch[2]),
            parseFloat(diffuseMatch[3]),
          ]
        : [0.8, 0.8, 0.8],
      specular: specularMatch
        ? [
            parseFloat(specularMatch[1]),
            parseFloat(specularMatch[2]),
            parseFloat(specularMatch[3]),
          ]
        : [1, 1, 1],
    };
  }

  private static parseGeomObject(block: string): ASEMesh | null {
    const nameMatch = block.match(/\*NODE_NAME\s+"([^"]*)"/);
    const name = nameMatch ? nameMatch[1] : "unnamed";

    // Find mesh block
    const meshMatch = block.match(/\*MESH\s*\{([\s\S]*)\}/);
    if (!meshMatch) return null;

    const meshBlock = meshMatch[1];

    // Parse vertices
    const vertices: ASEVertex[] = [];
    const vertexRegex =
      /\*MESH_VERTEX\s+\d+\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/g;
    let match;
    while ((match = vertexRegex.exec(meshBlock)) !== null) {
      vertices.push({
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        z: parseFloat(match[3]),
      });
    }

    // Parse faces
    const faces: ASEFace[] = [];
    const faceRegex =
      /\*MESH_FACE\s+\d+:\s+A:\s*(\d+)\s+B:\s*(\d+)\s+C:\s*(\d+).*?\*MESH_MTLID\s+(\d+)/g;
    while ((match = faceRegex.exec(meshBlock)) !== null) {
      faces.push({
        a: parseInt(match[1], 10),
        b: parseInt(match[2], 10),
        c: parseInt(match[3], 10),
        materialId: parseInt(match[4], 10),
      });
    }

    // If no MTLID found, try simpler face format
    if (faces.length === 0) {
      const simpleFaceRegex =
        /\*MESH_FACE\s+\d+:\s+A:\s*(\d+)\s+B:\s*(\d+)\s+C:\s*(\d+)/g;
      while ((match = simpleFaceRegex.exec(meshBlock)) !== null) {
        faces.push({
          a: parseInt(match[1], 10),
          b: parseInt(match[2], 10),
          c: parseInt(match[3], 10),
          materialId: 0,
        });
      }
    }

    // Parse texture vertices
    const texVertices: ASETexVertex[] = [];
    const tvertRegex = /\*MESH_TVERT\s+\d+\s+([-\d.]+)\s+([-\d.]+)/g;
    while ((match = tvertRegex.exec(meshBlock)) !== null) {
      texVertices.push({
        u: parseFloat(match[1]),
        v: parseFloat(match[2]),
      });
    }

    // Parse texture faces
    const texFaces: ASETexFace[] = [];
    const tfaceRegex = /\*MESH_TFACE\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)/g;
    while ((match = tfaceRegex.exec(meshBlock)) !== null) {
      texFaces.push({
        a: parseInt(match[1], 10),
        b: parseInt(match[2], 10),
        c: parseInt(match[3], 10),
      });
    }

    // Parse normals
    const normals: ASEFaceNormals[] = [];
    const normalsBlock = meshBlock.match(
      /\*MESH_NORMALS\s*\{([\s\S]*?)\n\t*\}/,
    );
    if (normalsBlock) {
      const faceNormalRegex =
        /\*MESH_FACENORMAL\s+\d+\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/g;
      const vertNormalRegex =
        /\*MESH_VERTEXNORMAL\s+\d+\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/g;

      // Split by face normals
      const faceNormalMatches = [...normalsBlock[1].matchAll(faceNormalRegex)];
      const vertNormalMatches = [...normalsBlock[1].matchAll(vertNormalRegex)];

      for (let i = 0; i < faceNormalMatches.length; i++) {
        const fn = faceNormalMatches[i];
        const vertNormals: ASENormal[] = [];

        // Each face has 3 vertex normals following it
        for (let j = 0; j < 3; j++) {
          const vnIdx = i * 3 + j;
          if (vnIdx < vertNormalMatches.length) {
            const vn = vertNormalMatches[vnIdx];
            vertNormals.push({
              x: parseFloat(vn[1]),
              y: parseFloat(vn[2]),
              z: parseFloat(vn[3]),
            });
          }
        }

        normals.push({
          face: {
            x: parseFloat(fn[1]),
            y: parseFloat(fn[2]),
            z: parseFloat(fn[3]),
          },
          vertices: vertNormals,
        });
      }
    }

    if (vertices.length === 0 || faces.length === 0) {
      return null;
    }

    return { name, vertices, faces, texVertices, texFaces, normals };
  }
}

export class ASELoader {
  async load(url: string, textureUrl?: string): Promise<THREE.Group> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ASE file: ${response.statusText}`);
    }

    const source = await response.text();
    const data = ASEParser.parse(source);

    return this.buildMesh(data, textureUrl);
  }

  private buildMesh(data: ASEFile, textureUrl?: string): THREE.Group {
    const group = new THREE.Group();

    // Create default material
    let material: THREE.Material;
    if (textureUrl) {
      const texture = new THREE.TextureLoader().load(textureUrl);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshLambertMaterial({ map: texture });
    } else if (data.materials.length > 0 && data.materials[0].diffuse) {
      const mat = data.materials[0];
      material = new THREE.MeshLambertMaterial({
        color: new THREE.Color(mat.diffuse[0], mat.diffuse[1], mat.diffuse[2]),
      });
    } else {
      material = new THREE.MeshLambertMaterial({ color: 0x888888 });
    }

    // Build each mesh
    for (const meshData of data.meshes) {
      const geometry = this.buildGeometry(meshData);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = meshData.name;
      group.add(mesh);
    }

    return group;
  }

  /**
   * Build BufferGeometry from ASE mesh data
   *
   * Coordinate system: ASE uses right-handed Z-up, Three.js uses right-handed Y-up
   * Transform: (x, y, z) -> (x, z, -y)
   */
  private buildGeometry(meshData: ASEMesh): THREE.BufferGeometry {
    const hasUVs =
      meshData.texVertices.length > 0 &&
      meshData.texFaces.length === meshData.faces.length;
    const hasNormals = meshData.normals.length === meshData.faces.length;

    // We need to build non-indexed geometry because UVs are per-face-vertex
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < meshData.faces.length; i++) {
      const face = meshData.faces[i];

      // Get vertices for this face
      const vA = meshData.vertices[face.a];
      const vB = meshData.vertices[face.b];
      const vC = meshData.vertices[face.c];

      // Transform coordinates and reverse winding order for correct front-face
      // ASE winding is A->B->C, we output A->C->B to flip
      const [ax, ay, az] = transformCoord(vA.x, vA.y, vA.z);
      const [bx, by, bz] = transformCoord(vB.x, vB.y, vB.z);
      const [cx, cy, cz] = transformCoord(vC.x, vC.y, vC.z);

      positions.push(ax, ay, az);
      positions.push(cx, cy, cz);
      positions.push(bx, by, bz);

      // Normals - vertex normals in ASE are listed in order [A, B, C] for each face
      if (hasNormals && meshData.normals[i]) {
        const faceNormals = meshData.normals[i].vertices;
        if (faceNormals.length === 3) {
          // Transform normals the same way as positions
          // Order matches vertex order: A, C, B
          const [nax, nay, naz] = transformCoord(
            faceNormals[0].x,
            faceNormals[0].y,
            faceNormals[0].z,
          );
          const [nbx, nby, nbz] = transformCoord(
            faceNormals[1].x,
            faceNormals[1].y,
            faceNormals[1].z,
          );
          const [ncx, ncy, ncz] = transformCoord(
            faceNormals[2].x,
            faceNormals[2].y,
            faceNormals[2].z,
          );

          normals.push(nax, nay, naz); // Normal for vertex A
          normals.push(ncx, ncy, ncz); // Normal for vertex C (swapped)
          normals.push(nbx, nby, nbz); // Normal for vertex B (swapped)
        } else {
          // Use face normal for all vertices
          const fn = meshData.normals[i].face;
          const [fnx, fny, fnz] = transformCoord(fn.x, fn.y, fn.z);
          normals.push(fnx, fny, fnz);
          normals.push(fnx, fny, fnz);
          normals.push(fnx, fny, fnz);
        }
      }

      // UVs
      if (hasUVs) {
        const texFace = meshData.texFaces[i];
        const uvA = meshData.texVertices[texFace.a];
        const uvB = meshData.texVertices[texFace.b];
        const uvC = meshData.texVertices[texFace.c];

        // Match the swapped vertex order (A, C, B)
        if (uvA && uvC && uvB) {
          uvs.push(uvA.u, 1 - uvA.v); // Flip V for Three.js
          uvs.push(uvC.u, 1 - uvC.v);
          uvs.push(uvB.u, 1 - uvB.v);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );

    if (normals.length > 0) {
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
    } else {
      geometry.computeVertexNormals();
    }

    if (uvs.length > 0) {
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }

    return geometry;
  }
}
