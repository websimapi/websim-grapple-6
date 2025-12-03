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
        // REMOVED fixed repeat to allow dynamic UV scaling
        // this.roadTexture.repeat.set(1, 4);
        
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
        
        // Height Control
        this.targetY = 0;
        this.layerStep = 40;

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
        // Rotate geometry to lie on XZ plane with +Z as forward (length)
        // This ensures lookAt works naturally and normals are correct
        const geo = new THREE.PlaneGeometry(this.width, Math.sqrt(length*length + endOffset.y*endOffset.y)); 
        
        // Fix UVs to scale with length for consistent texture density
        const uvAttribute = geo.attributes.uv;
        const uvScale = length / 12; // Approx 1 tile per width unit
        for ( let i = 0; i < uvAttribute.count; i ++ ) {
            // v coordinate corresponds to the length axis after rotation
            const v = uvAttribute.getY( i );
            uvAttribute.setY( i, v * uvScale );
        }
        
        geo.rotateX(-Math.PI / 2); // Rotate to XZ plane

        const mesh = new THREE.Mesh(geo, this.roadMat);
        
        // Position at midpoint
        const midPoint = new THREE.Vector3().lerpVectors(startPos, endPos, 0.5);
        mesh.position.copy(midPoint);
        
        // Orientation: Look at end point
        // Since geometry +Z is length, this aligns perfectly
        mesh.lookAt(endPos);
        
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
            cornerGeo.rotateX(-Math.PI / 2); // Flat XZ
            
            const cornerMesh = new THREE.Mesh(cornerGeo, this.roadMat);
            
            // Corner center
            // Since slope is 0 for turns (enforced), math is simple
            const cornerOffset = this.currentDir.clone().multiplyScalar(this.width / 2);
            // Just in case slope wasn't 0, we maintain continuity, but visuals might break if not 0
            cornerOffset.y = (this.width/2) * slope; 
            
            const cornerCenter = this.currentPos.clone().add(cornerOffset);
            
            cornerMesh.position.copy(cornerCenter);
            
            // Align with incoming road
            cornerMesh.quaternion.copy(mesh.quaternion);

            this.trackGroup.add(cornerMesh);
            cornerMesh.receiveShadow = true;

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
        // Cleanup old segments to maintain performance
        if (this.segments.length > 60) {
            const oldSeg = this.segments.shift();
            this.trackGroup.remove(oldSeg.mesh);
            if (oldSeg.mesh.geometry) oldSeg.mesh.geometry.dispose();
            // Note: Posts are in a separate array, but visual cleanup of track is main priority
        }

        const maxAttempts = 15;
        
        // Update Target Height Layer
        // If we are somewhat level with our target, maybe switch layers
        if (Math.abs(this.currentPos.y - this.targetY) < 10 && Math.random() < 0.25) {
            const dir = Math.random() > 0.5 ? 1 : -1;
            let newTarget = this.targetY + (dir * this.layerStep);
            
            // Soft Bounds
            if (newTarget > 120) newTarget -= this.layerStep * 2;
            else if (newTarget < -120) newTarget += this.layerStep * 2;
            
            this.targetY = newTarget;
        }

        for (let i = 0; i < maxAttempts; i++) {
            // Random parameters
            const type = Math.random() < 0.4 ? 'straight' : 'turn';
            let length, turnDir, angle, slope;

            if (type === 'straight') {
                length = 80 + Math.random() * 60;
                turnDir = 0;
                angle = 0;
                
                // Slope Logic: Steer towards targetY
                const heightDiff = this.targetY - this.currentPos.y;
                slope = heightDiff / (length * 1.5);
                
                // Clamp slope
                const maxSlope = 0.35; 
                if (slope > maxSlope) slope = maxSlope;
                if (slope < -maxSlope) slope = -maxSlope;
                
                // Add noise
                slope += (Math.random() - 0.5) * 0.08;
                
            } else {
                length = 50 + Math.random() * 30;
                turnDir = Math.random() > 0.5 ? 1 : -1;
                angle = Math.PI / 2;
                slope = 0; // CRITICAL: Turns must be flat to ensure geometry aligns at the 90 degree connector
            }

            // Proposed OBB for checking
            const tempDir = this.currentDir.clone();
            const tempPos = this.currentPos.clone();
            
            const forwardOffset = tempDir.clone().multiplyScalar(length / 2);
            const center = tempPos.clone().add(forwardOffset);
            const segAngle = -Math.atan2(tempDir.x, tempDir.z);

            // Check Collision
            if (this.checkCollision(center, this.width, length, segAngle, slope, tempPos.y)) {
                continue;
            }

            // Valid
            this.addSegment(type, length, turnDir, angle, slope);
            return;
        }

        // Fallback: Force a steep escape towards target
        const escapeSlope = (this.targetY > this.currentPos.y) ? 0.4 : -0.4;
        this.addSegment('straight', 60, 0, 0, escapeSlope);
    }

    checkCollision(center, width, length, angle, slope, startY) {
        // Approximate height at center
        const centerY = startY + (length/2) * slope;
        const heightClearance = 25; // 25m clearance for clean overpasses

        // Optimization: Only check last 50 segments
        const startIdx = Math.max(0, this.segments.length - 50);
        const checkCount = this.segments.length - 2;
        
        for (let i = startIdx; i < checkCount; i++) {
            const other = this.segments[i];
            
            // 1. Broad Phase
            if (center.distanceTo(other.mesh.position) > (length + other.length)) continue;

            // 2. Narrow Phase
            if (boxIntersectsBox(
                center, width * 0.8, length, angle,
                other.mesh.position, other.width * 0.8, other.length, other.angle
            )) {
                // Check Angle
                let a1 = angle % Math.PI; if(a1<0) a1+=Math.PI;
                let a2 = other.angle % Math.PI; if(a2<0) a2+=Math.PI;
                let diff = Math.abs(a1 - a2);
                if (diff > Math.PI/2) diff = Math.PI - diff;

                const isParallel = diff < (Math.PI / 6); 

                if (isParallel) {
                    // Parallel overlap is NOT permitted (no stacked roads)
                    return true;
                } else {
                    // Crossing overlap
                    const otherY = other.mesh.position.y;
                    if (Math.abs(centerY - otherY) < heightClearance) {
                        // Crossing but too close vertically
                        return true; 
                    }
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