import * as THREE from 'three';
import { boxIntersectsBox } from './utils.js';

export class TrackManager {
    constructor(scene) {
        this.scene = scene;
        this.trackGroup = new THREE.Group();
        this.scene.add(this.trackGroup);

        this.segments = [];
        this.posts = [];
        this.width = 12; 

        // Texture Loading
        const loader = new THREE.TextureLoader();
        this.roadTexture = loader.load('./asphalt_tile.png');
        this.roadTexture.wrapS = THREE.RepeatWrapping;
        this.roadTexture.wrapT = THREE.RepeatWrapping;
        this.roadTexture.repeat.set(1, 4);
        
        // Texture Filtering for smoother look
        this.roadTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.roadTexture.magFilter = THREE.LinearFilter;
        this.roadTexture.anisotropy = 16; // Maximize sharpness at angles

        this.roadMat = new THREE.MeshStandardMaterial({ 
            map: this.roadTexture,
            roughness: 0.4, // Increased roughness for less plastic look
            metalness: 0.1, // Reduced metalness
            color: 0x666666 // Slightly lighter to show texture details
        });

        // Ensure material is double sided just in case camera clips under
        this.roadMat.side = THREE.DoubleSide;

        const postTexture = loader.load('./post_texture.png');
        this.postGeo = new THREE.CylinderGeometry(0.8, 0.8, 6, 16);
        this.postMat = new THREE.MeshStandardMaterial({ 
            map: postTexture,
            color: 0xffffff, 
            emissive: 0xff4400,
            emissiveIntensity: 1.5,
            metalness: 0.8,
            roughness: 0.2
        });

        // Initial generation state
        this.currentPos = new THREE.Vector3(0, 0, 0);
        this.currentDir = new THREE.Vector3(0, 0, 1); // Moving +Z
        this.segmentLength = 50;

        // Build initial straight
        this.addSegment('straight', 80, 0, 0, 0); // Flat start
        this.generateNextSegment();
        this.generateNextSegment();
        this.generateNextSegment();
    }

    addSegment(type, length = 50, turnDir = 1, angle = Math.PI / 2, slope = 0) {
        const startPos = this.currentPos.clone();
        
        // Calculate end position based on direction and slope
        // Direction is 2D (XZ), Slope affects Y
        const endOffset = this.currentDir.clone().multiplyScalar(length);
        endOffset.y = length * slope; // dy = run * slope
        
        const endPos = startPos.clone().add(endOffset);

        const seg = {
            type: type,
            start: startPos,
            end: endPos,
            width: this.width,
            length: length,
            angle: -Math.atan2(this.currentDir.x, this.currentDir.z), // 2D Rotation
            mesh: null,
            slope: slope
        };
        
        // Visuals
        const geo = new THREE.PlaneGeometry(this.width, Math.sqrt(length*length + endOffset.y*endOffset.y)); // Hypothenuse length
        const mesh = new THREE.Mesh(geo, this.roadMat);
        
        // Position at midpoint
        const midPoint = new THREE.Vector3().lerpVectors(startPos, endPos, 0.5);
        mesh.position.copy(midPoint);
        
        // Orientation: Look at end point from start point
        mesh.lookAt(endPos);
        
        // Rotate local X to flatten it (PlaneGeometry is XY)
        // lookAt aligns +Z to target. We want the plane (XY) to lie along the path.
        // Actually, let's reset and do it manually for full control
        // Default Plane is XY.
        // We want Y-axis of plane to point along the path. 
        // We want Z-axis of plane to point UP (normal).
        
        // Simpler approach with lookAt:
        // Plane is XY. mesh.lookAt aligns -Z axis to target? No +Z usually.
        // Let's rely on lookAt but rotate geometry so it aligns correctly.
        // If we rotate geometry X by -PI/2, it becomes XZ plane.
        // Then lookAt will align its Z axis (Normal) to the target... which is wrong. We want the Normal to be UP.
        
        // Correct approach:
        // 1. Position at midpoint.
        // 2. LookAt endPos.
        // 3. Rotate 90deg on local X to make the plane flat.
        mesh.lookAt(endPos); 
        mesh.rotateX(-Math.PI / 2); // Now flat relative to the look direction
        // Adjust for PlaneGeometry orientation (it's Y-up initially, rotating -90 X makes it Z-forward).
        // But we want the texture to tile along Z?
        // Plane UVs are 0..1 on X and Y.
        // If we rotate X -90, Y axis of UV points along Z world (forward). This is good for tiling.
        
        // Important: Update rotation for OBB checks
        // We store the 2D rotation for collision logic
        
        // Enable shadows
        mesh.receiveShadow = true;
        
        this.trackGroup.add(mesh);
        seg.mesh = mesh;
        this.segments.push(seg);

        // Update head
        this.currentPos.copy(endPos);

        // Turn Logic
        if (type === 'turn') {
            // Corner patch
            const cornerGeo = new THREE.PlaneGeometry(this.width, this.width);
            const cornerMesh = new THREE.Mesh(cornerGeo, this.roadMat);
            cornerMesh.rotateX(-Math.PI / 2); // Flat
            
            // Corner center needs to account for slope?
            // Usually corners are flat or continue the slope.
            // Simplified: Corners are flat connectors at the new elevation.
            
            // Position corner center: CurrentPos + Half Width forward *in new slope direction?*
            // Simplifying: Assume corners are flat (slope 0) to avoid banking math headaches
            // Or just continue the previous slope's rise for half-width.
            
            const cornerOffset = this.currentDir.clone().multiplyScalar(this.width / 2);
            cornerOffset.y = (this.width/2) * slope;
            const cornerCenter = this.currentPos.clone().add(cornerOffset);
            
            cornerMesh.position.copy(cornerCenter);
            
            // Align rotation with incoming road (XZ)
            // Pitch of corner matches incoming slope
            cornerMesh.rotation.set(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z); 
            // Actually, mesh rotation is complex due to lookAt. 
            // Let's just match the visual orientation of the end of the road.
            cornerMesh.quaternion.copy(mesh.quaternion);

            this.trackGroup.add(cornerMesh);

            this.segments.push({
                type: 'corner',
                mesh: cornerMesh,
                start: this.currentPos.clone(), // This is the "start" of the corner
                width: this.width,
                length: this.width,
                angle: seg.angle,
                slope: slope
            });

            // Post Generation
            const perp = new THREE.Vector3(-this.currentDir.z, 0, this.currentDir.x);
            const cornerVector = perp.clone().multiplyScalar(-turnDir).sub(this.currentDir).normalize();
            
            // Post position
            const postPos = cornerCenter.clone().add(cornerVector.multiplyScalar(12));
            // Adjust post height to match track
            postPos.y += 2; 

            const post = new THREE.Mesh(this.postGeo, this.postMat);
            post.position.copy(postPos);
            this.scene.add(post);

            this.posts.push({
                mesh: post,
                position: postPos,
                active: true
            });

            // Update State for NEXT segment
            this.currentPos.add(cornerOffset); // Move to center of corner
            
            // Rotate direction
            const rotationAxis = new THREE.Vector3(0, 1, 0);
            this.currentDir.applyAxisAngle(rotationAxis, turnDir * angle); 
            
            // Move to edge of corner in new direction
            const exitOffset = this.currentDir.clone().multiplyScalar(this.width / 2);
            // exitOffset.y = (this.width/2) * slope; // Continue slope?
            // Let's flatten the exit slightly or keep slope.
            // Ideally, corners flatten out to transition.
            
            this.currentPos.add(exitOffset);
        }
    }

    generateNextSegment() {
        const maxAttempts = 10;
        
        for (let i = 0; i < maxAttempts; i++) {
            // Random parameters
            const type = Math.random() < 0.4 ? 'straight' : 'turn';
            let length, turnDir, angle, slope;

            if (type === 'straight') {
                length = 80 + Math.random() * 60;
                turnDir = 0;
                angle = 0;
            } else {
                length = 50 + Math.random() * 30;
                turnDir = Math.random() > 0.5 ? 1 : -1;
                angle = Math.PI / 2;
            }

            // Slope generation: 30% chance to change elevation
            slope = 0;
            if (Math.random() < 0.4) {
                // Determine slope based on current height to keep within bounds
                // Soft bounds: -100 to 100
                if (this.currentPos.y > 100) slope = -0.2 - Math.random() * 0.1;
                else if (this.currentPos.y < -100) slope = 0.2 + Math.random() * 0.1;
                else slope = (Math.random() - 0.5) * 0.6; // +/- 0.3 slope
            }

            // Proposed OBB for checking
            const tempDir = this.currentDir.clone();
            const tempPos = this.currentPos.clone();
            
            // Calculate center and dimensions of proposed segment
            // (Simplified: check the main road part, ignore corner bit for now)
            const forwardOffset = tempDir.clone().multiplyScalar(length / 2);
            const center = tempPos.clone().add(forwardOffset);
            const segAngle = -Math.atan2(tempDir.x, tempDir.z);

            // Check Collision
            if (this.checkCollision(center, this.width, length, segAngle, slope, tempPos.y)) {
                // If collision is bad (parallel or too close in height), retry
                continue;
            }

            // Valid
            this.addSegment(type, length, turnDir, angle, slope);
            return;
        }

        // Fallback: Force a straight section with steep slope up to escape
        this.addSegment('straight', 60, 0, 0, 0.4);
    }

    checkCollision(center, width, length, angle, slope, startY) {
        // Approximate height at center
        const centerY = startY + (length/2) * slope;
        const heightClearance = 15; // Minimum vertical distance between roads

        // Check against recent segments (exclude very last 2 to allow connection)
        const checkCount = this.segments.length - 2;
        
        for (let i = 0; i < checkCount; i++) {
            const other = this.segments[i];
            
            // 1. Broad Phase: Distance check
            if (center.distanceTo(other.mesh.position) > (length + other.length)) continue;

            // 2. Narrow Phase: OBB Intersection in XZ plane
            // Use width * 0.8 to be slightly lenient on edge grazes
            if (boxIntersectsBox(
                center, width * 0.8, length, angle,
                other.mesh.position, other.width * 0.8, other.length, other.angle
            )) {
                // Overlap detected!
                
                // Check Angle difference (Parallel vs Crossing)
                // Normalize angles to 0-PI
                let a1 = angle % Math.PI; if(a1<0) a1+=Math.PI;
                let a2 = other.angle % Math.PI; if(a2<0) a2+=Math.PI;
                let diff = Math.abs(a1 - a2);
                if (diff > Math.PI/2) diff = Math.PI - diff;

                const isParallel = diff < (Math.PI / 6); // < 30 degrees

                if (isParallel) {
                    // Parallel overlap is NOT permitted
                    return true;
                } else {
                    // Crossing overlap
                    // Check height difference
                    const otherY = other.mesh.position.y;
                    if (Math.abs(centerY - otherY) < heightClearance) {
                        // Crossing but too close vertically
                        return true; 
                    }
                    // Else: Crossing with sufficient height - Permitted!
                }
            }
        }
        return false;
    }

    // Deprecated OBB check - now handled by Car Raycasting
    isOnTrack(position) {
        return true; 
    }

    getNearestPost(position) {
        let nearest = null;
        let minDist = Infinity;

        // Optimization: Only check recent posts
        const checkCount = Math.min(this.posts.length, 4);
        const startIndex = this.posts.length - checkCount;

        for (let i = startIndex; i < this.posts.length; i++) {
            const post = this.posts[i];
            const dist = position.distanceTo(post.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = post;
            }
        }
        return { post: nearest, distance: minDist };
    }
}