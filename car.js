import * as THREE from 'three';

export class Car {
    constructor(scene) {
        this.scene = scene;
        this.mesh = new THREE.Group();
        
        // Physics state
        this.position = new THREE.Vector3(0, 10, 0); // Start high to drop onto track
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.speed = 30; 
        this.direction = new THREE.Vector3(0, 0, 1); 
        this.verticalVelocity = 0;
        this.isGrounded = false;
        
        // Raycaster for track detection
        this.raycaster = new THREE.Raycaster();
        this.raycaster.ray.direction.set(0, -1, 0);
        this.down = new THREE.Vector3(0, -1, 0);
        
        // Grapple State
        this.grappleState = 'IDLE'; 
        this.grappleTarget = null;
        this.hookPosition = new THREE.Vector3();
        this.grappleCount = 0;
        
        // Visuals
        this.createDetailedMesh();
        
        // --- GRAPPLE VISUALS ---
        
        // 1. Detailed Hook Mesh
        this.hookMesh = new THREE.Group();
        
        // Shaft
        const shaftGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 8);
        shaftGeo.rotateX(-Math.PI / 2); // Align with Z
        const shaftMat = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            metalness: 0.9, 
            roughness: 0.1 
        });
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        this.hookMesh.add(shaft);

        // Claws
        const clawMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ffff, 
            emissive: 0x004444,
            metalness: 0.8, 
            roughness: 0.2 
        });
        
        // Create 3 Claws
        for(let i=0; i<3; i++) {
            const pivot = new THREE.Group();
            pivot.rotation.z = (i / 3) * Math.PI * 2;
            
            const clawGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);
            // Bend/Angle the claw
            clawGeo.translate(0, 0.3, 0); // Pivot at base
            
            const claw = new THREE.Mesh(clawGeo, clawMat);
            claw.rotation.x = Math.PI / 3; // Open angle
            claw.position.z = 0.2; // Offset from shaft center
            
            pivot.add(claw);
            this.hookMesh.add(pivot);
        }
        
        // Glowing Core / Magnet
        const coreGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 16);
        coreGeo.rotateX(-Math.PI / 2);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        const core = new THREE.Mesh(coreGeo, coreMat);
        this.hookMesh.add(core);

        this.scene.add(this.hookMesh);
        this.hookMesh.visible = false;

        // 2. Thick Grapple Rope (Tube/Cylinder)
        // Geometry designed to be scaled along Z axis
        const ropeGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 8);
        ropeGeo.translate(0, 0.5, 0); // Pivot at bottom
        ropeGeo.rotateX(Math.PI / 2); // Align Y to Z
        
        const ropeMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ffff,
            emissive: 0x00aaaa,
            emissiveIntensity: 1.0,
            roughness: 0.4,
            metalness: 0.5
        });

        this.grappleRope = new THREE.Mesh(ropeGeo, ropeMat);
        this.grappleRope.frustumCulled = false; // Important: prevent disappearing when stretching
        this.grappleRope.visible = false;
        this.scene.add(this.grappleRope);

        // Drift particles (Basic)
        this.smokeParticles = [];
    }

    createDetailedMesh() {
        // Car Dimensions
        const width = 1.8;
        const length = 4.2;
        const height = 0.8;

        // Materials
        const bodyMat = new THREE.MeshStandardMaterial({ 
            color: 0x111111, 
            metalness: 0.9, 
            roughness: 0.2,
        });
        
        const cabinMat = new THREE.MeshPhysicalMaterial({ 
            color: 0x000000,
            metalness: 1.0,
            roughness: 0.0,
            transmission: 0.2, // Looks like dark glass
            reflectivity: 1.0
        });

        const neonCyan = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        const neonMagenta = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const headLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

        // 1. Main Chassis
        const chassisGeo = new THREE.BoxGeometry(width, height, length);
        const chassis = new THREE.Mesh(chassisGeo, bodyMat);
        chassis.position.y = height / 2 + 0.3; // Lift off ground
        chassis.castShadow = true;
        this.mesh.add(chassis);

        // 2. Cabin / Cockpit
        const cabinGeo = new THREE.BoxGeometry(width * 0.7, height * 0.6, length * 0.4);
        const cabin = new THREE.Mesh(cabinGeo, cabinMat);
        cabin.position.set(0, height + 0.3 + (height * 0.3), -0.2);
        this.mesh.add(cabin);

        // 3. Side Pontoons / Fenders (Wider lower body)
        const fenderGeo = new THREE.BoxGeometry(width + 0.4, height * 0.6, length);
        const fender = new THREE.Mesh(fenderGeo, bodyMat);
        fender.position.set(0, 0.5, 0);
        this.mesh.add(fender);

        // 4. Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughnes: 0.8 });
        
        const wheelPositions = [
            [-0.9, 0.4, 1.2], // FL
            [0.9, 0.4, 1.2],  // FR
            [-0.9, 0.4, -1.2], // RL
            [0.9, 0.4, -1.2]   // RR
        ];

        wheelPositions.forEach(pos => {
            const wheel = new THREE.Mesh(wheelGeo, wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(...pos);
            this.mesh.add(wheel);
        });

        // 5. Neon Strips
        const stripGeo = new THREE.BoxGeometry(0.1, 0.1, length * 0.9);
        
        const leftStrip = new THREE.Mesh(stripGeo, neonCyan);
        leftStrip.position.set(-width/2 - 0.2, 0.8, 0);
        this.mesh.add(leftStrip);

        const rightStrip = new THREE.Mesh(stripGeo, neonMagenta);
        rightStrip.position.set(width/2 + 0.2, 0.8, 0);
        this.mesh.add(rightStrip);

        // 6. Lights
        const headLightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
        const hlLeft = new THREE.Mesh(headLightGeo, headLightMat);
        hlLeft.position.set(-0.5, 0.7, length/2);
        this.mesh.add(hlLeft);

        const hlRight = new THREE.Mesh(headLightGeo, headLightMat);
        hlRight.position.set(0.5, 0.7, length/2);
        this.mesh.add(hlRight);

        const tailLightGeo = new THREE.BoxGeometry(0.3, 0.2, 0.1);
        const tlLeft = new THREE.Mesh(tailLightGeo, tailLightMat);
        tlLeft.position.set(-0.6, 0.8, -length/2);
        this.mesh.add(tlLeft);

        const tlRight = new THREE.Mesh(tailLightGeo, tailLightMat);
        tlRight.position.set(0.6, 0.8, -length/2);
        this.mesh.add(tlRight);

        // Spoiler
        const spoilerGeo = new THREE.BoxGeometry(width + 0.4, 0.1, 0.8);
        const spoiler = new THREE.Mesh(spoilerGeo, bodyMat);
        spoiler.position.set(0, 1.2, -length/2 + 0.2);
        this.mesh.add(spoiler);

        const spoilerPostGeo = new THREE.BoxGeometry(0.1, 0.4, 0.4);
        const spLeft = new THREE.Mesh(spoilerPostGeo, bodyMat);
        spLeft.position.set(-0.6, 1.0, -length/2 + 0.4);
        this.mesh.add(spLeft);
        
        const spRight = new THREE.Mesh(spoilerPostGeo, bodyMat);
        spRight.position.set(0.6, 1.0, -length/2 + 0.4);
        this.mesh.add(spRight);


        // Real Lights
        const light = new THREE.SpotLight(0xffffff, 20, 80, 0.6, 0.5, 1);
        light.position.set(0, 2, 0);
        light.target.position.set(0, 0, 15);
        this.mesh.add(light);
        this.mesh.add(light.target);

        // Engine Glow
        const engineLight = new THREE.PointLight(0x00ffff, 2, 5);
        engineLight.position.set(0, 0.5, -1.5);
        this.mesh.add(engineLight);

        this.scene.add(this.mesh);
    }

    createMesh() {
        // Deprecated simple mesh
    }

    hide() {
        this.mesh.visible = false;
        this.hookMesh.visible = false;
        this.grappleRope.visible = false;
    }

    update(dt, input, trackManager) {
        // 1. Input & State Management
        const grappleInfo = trackManager.getNearestPost(this.position);
        
        // Raycast for ground
        this.raycaster.set(this.position.clone().add(new THREE.Vector3(0, 5, 0)), this.down);
        const intersects = this.raycaster.intersectObjects(trackManager.trackGroup.children);
        
        let groundY = -999;
        this.isGrounded = false;

        if (intersects.length > 0) {
            // Find highest point below us (or closest)
            // intersects is sorted by distance
            const hit = intersects[0];
            // Since we cast from +5, hit.distance should be around 5 if we are on ground (y=0 relative to ray)
            // Ground Y is rayOrigin.y - hit.distance
            groundY = (this.position.y + 5) - hit.distance;
            
            // Allow snapping if we are close enough (e.g. within 2 units)
            // If we are flying high (grappling), we might ignore this
            if (hit.distance < 15) { // 10 units range below car
                this.isGrounded = true;
            }
        }

        // Input Handling
        if (input.mouseDown) {
            // Attempt to fire if IDLE and valid target
            if (this.grappleState === 'IDLE' && grappleInfo.post && grappleInfo.distance < 45) { 
                this.fireGrapple(grappleInfo.post);
            }
        } else {
            // Release if currently engaged
            if (this.grappleState === 'FIRING' || this.grappleState === 'ATTACHED') {
                this.releaseGrapple();
            }
        }

        // State Machine Logic
        this.updateGrapplePhysics(dt);

        // Banking Logic (Roll)
        let targetRoll = 0;

        // 2. Car Movement
        if (this.grappleState === 'ATTACHED' && this.grappleTarget) {
            // Circular Motion Logic
            const postPos = this.grappleTarget.position;
            const radiusVector = new THREE.Vector3().subVectors(this.position, postPos);
            const radius = radiusVector.length();
            
            // Calculate tangent direction (Perpendicular to radius)
            let tangent = new THREE.Vector3().crossVectors(radiusVector, new THREE.Vector3(0, 1, 0)).normalize();
            
            // Check if tangent aligns with current velocity, if not, flip it
            if (tangent.dot(this.direction) < 0) {
                tangent.negate();
            }

            // Move along tangent
            const arcLength = this.speed * dt;
            const angleChange = arcLength / radius;
            
            // Determine rotation direction
            const toPost = new THREE.Vector3().subVectors(postPos, this.position);
            const crossY = new THREE.Vector3().crossVectors(this.direction, toPost).y;
            const rotDir = crossY > 0 ? -1 : 1; 

            // Calculate Bank Angle based on turn
            // rotDir: 1 = Left Turn (Post is Left), -1 = Right Turn
            // Bank into turn: Left Turn -> Roll Left (+Z in this coord system if Z is Forward? No check update logic below)
            targetRoll = rotDir * 0.35; // ~20 degrees bank

            // Apply rotation to position
            const pos2D = new THREE.Vector2(this.position.x - postPos.x, this.position.z - postPos.z);
            pos2D.rotateAround(new THREE.Vector2(0,0), rotDir * angleChange);
            
            this.position.x = postPos.x + pos2D.x;
            this.position.z = postPos.z + pos2D.y;

            // Maintain height or drift?
            // If grounded, stick to ground, but grapple pulls us?
            // Grapple physics usually override gravity. 
            // For arcade feel: keep sticky if close to ground, else fly.
            // But we simplify: Keep Y based on gravity/ground
            
            // Update direction to new tangent
            this.direction.copy(tangent).normalize();
            
            // Increase speed slightly during drift
            this.speed = Math.min(this.speed + 15 * dt, 55);

        } else {
            // Linear Motion
            // Normalize speed back to base
            this.speed = THREE.MathUtils.lerp(this.speed, 35, dt * 2);

            const moveStep = this.direction.clone().multiplyScalar(this.speed * dt);
            this.position.add(moveStep);
            
            targetRoll = 0; // Level out
        }

        // 3. Vertical Physics (Gravity / Snap)
        const hoverHeight = 0.8;
        
        if (this.isGrounded) {
            // Snap to ground with smoothing
            const targetY = groundY + hoverHeight;
            // Lerp Y for smooth ramps
            this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, dt * 15);
            this.verticalVelocity = 0;
            
            // Pitch alignment to slope?
            // Not implemented for simplicity, car stays flat, but model could pitch.
            // Just handling Position Y is enough for gameplay.
        } else {
            // Apply Gravity
            this.verticalVelocity -= 50 * dt; // Gravity
            this.position.y += this.verticalVelocity * dt;
        }

        // Hard floor check just in case
        if (this.position.y < -300) {
            // Too low, let Game handle death
        }

        // Apply Position
        this.mesh.position.copy(this.position);
        
        // Rotate Mesh
        const angle = Math.atan2(this.direction.x, this.direction.z);
        this.mesh.rotation.y = angle;

        // Apply Banking
        // Smoothly interpolate current roll to target
        const currentRoll = this.mesh.rotation.z;
        this.mesh.rotation.z = THREE.MathUtils.lerp(currentRoll, targetRoll, dt * 8);
    }

    fireGrapple(target) {
        this.grappleState = 'FIRING';
        this.grappleTarget = target;
        this.hookPosition.copy(this.position); // Start at car
        this.hookMesh.visible = true;
        this.grappleRope.visible = true;
    }

    releaseGrapple() {
        if (this.grappleState === 'ATTACHED') {
            this.grappleCount++;
            this.autoStraighten();
        }
        this.grappleState = 'RETRACTING';
        // Keep target for retraction origin references if needed, but we use hookPosition
        this.grappleTarget = null;
    }

    updateGrapplePhysics(dt) {
        const hookSpeed = 200; // Speed of hook travel

        if (this.grappleState === 'FIRING') {
            const targetPos = this.grappleTarget.position;
            const dist = this.hookPosition.distanceTo(targetPos);
            const travelDist = hookSpeed * dt;

            if (dist <= travelDist) {
                // Reached target
                this.hookPosition.copy(targetPos);
                this.grappleState = 'ATTACHED';
            } else {
                // Move towards target
                const dir = new THREE.Vector3().subVectors(targetPos, this.hookPosition).normalize();
                this.hookPosition.add(dir.multiplyScalar(travelDist));
            }
        }
        else if (this.grappleState === 'ATTACHED') {
            // Lock hook to post (in case of floating point drift or moving posts)
            if (this.grappleTarget) {
                this.hookPosition.copy(this.grappleTarget.position);
            }
        }
        else if (this.grappleState === 'RETRACTING') {
            const targetPos = this.position; // Retract to car
            const dist = this.hookPosition.distanceTo(targetPos);
            const travelDist = hookSpeed * dt;

            if (dist <= travelDist) {
                // Reached car
                this.grappleState = 'IDLE';
                this.hookMesh.visible = false;
                this.grappleRope.visible = false;
            } else {
                // Move towards car
                const dir = new THREE.Vector3().subVectors(targetPos, this.hookPosition).normalize();
                this.hookPosition.add(dir.multiplyScalar(travelDist));
            }
        }

        // Update Visuals
        if (this.grappleState !== 'IDLE') {
            // Update Rope Transform
            // We want the rope to start at the car's roof/grapple point and end at the hook
            
            const startPos = this.position.clone();
            startPos.y += 0.8; // Car roof height
            
            const endPos = this.hookPosition.clone();
            const dist = startPos.distanceTo(endPos);
            
            // 1. Position at start
            this.grappleRope.position.copy(startPos);
            // 2. Look at end
            this.grappleRope.lookAt(endPos);
            // 3. Scale Z to match distance (since geo is rotated to Z)
            this.grappleRope.scale.set(1, 1, dist);

            // Update Hook Mesh orientation
            this.hookMesh.position.copy(this.hookPosition);
            
            // Orient hook
            if (this.grappleState === 'FIRING') {
                this.hookMesh.lookAt(this.grappleTarget.position);
            } else if (this.grappleState === 'RETRACTING') {
                this.hookMesh.lookAt(this.position);
            } else {
                 // Attached: look at car (tension)
                 this.hookMesh.lookAt(this.position);
            }
        }
    }

    autoStraighten() {
        const cardinals = [
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(-1, 0, 0)
        ];

        let maxDot = -Infinity;
        let bestDir = null;

        for (const dir of cardinals) {
            const dot = this.direction.dot(dir);
            if (dot > maxDot) {
                maxDot = dot;
                bestDir = dir;
            }
        }

        // If reasonably aligned (within ~25 degrees, dot > 0.9), snap to cardinal direction
        if (maxDot > 0.9 && bestDir) {
            this.direction.copy(bestDir);
        }
    }
}