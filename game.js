import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { TrackManager } from './track.js';
import { Car } from './car.js';
import { Explosion, SpaceEnvironment } from './effects.js';
import { ReplayRecorder } from './replay.js';

export class Game {
    constructor() {
        this.container = document.getElementById('game-container');
        this.scoreEl = document.getElementById('score-display');
        this.grappleScoreEl = document.getElementById('grapple-display');
        this.gameOverScreen = document.getElementById('game-over-screen');
        this.finalScoreEl = document.getElementById('final-score');

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.002);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.cameraOffset = new THREE.Vector3(0, 20, -15); // Behind and above

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: false,
            preserveDrawingBuffer: true // Important for capturing canvas stream
        }); 
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Post Processing (Bloom)
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.1;
        bloomPass.strength = 1.2; // Neon glow intensity
        bloomPass.radius = 0.5;
        this.composer.addPass(bloomPass);

        // Lights
        this.addLights();

        // Input
        this.input = { mouseDown: false };
        window.addEventListener('mousedown', () => this.input.mouseDown = true);
        window.addEventListener('mouseup', () => this.input.mouseDown = false);
        window.addEventListener('touchstart', (e) => { 
            // Only capture touches on the game canvas/container so UI buttons still work
            const target = e.target;
            if (target === this.renderer.domElement || target.closest('#game-container')) {
                e.preventDefault(); 
                this.input.mouseDown = true; 
            }
        }, {passive: false});
        window.addEventListener('touchend', (e) => { 
            const target = e.target;
            if (target === this.renderer.domElement || target.closest('#game-container')) {
                e.preventDefault(); 
                this.input.mouseDown = false; 
            }
        }, {passive: false});

        // Resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Game State
        this.isRunning = false;
        this.isCrashing = false;
        this.distanceTraveled = 0;
        this.explosions = [];

        // Bindings
        document.getElementById('restart-btn').addEventListener('click', () => this.reset());

        // Audio
        this.setupAudio();

        // Replay System
        this.replayRecorder = new ReplayRecorder(this.renderer.domElement, this.listener);

        // Explosion / crash state
        this.explosionTriggered = false;
        this.interceptorSpawned = false;
    }

    addLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
        this.scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x222244, 1.2);
        this.scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(20, 40, 10);
        dirLight.castShadow = false;
        this.scene.add(dirLight);
    }

    setupAudio() {
        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);

        const audioLoader = new THREE.AudioLoader();
        this.engineSound = new THREE.Audio(this.listener);
        this.grappleSound = new THREE.Audio(this.listener);
        this.skidSound = new THREE.Audio(this.listener);

        audioLoader.load('./sfx_engine.mp3', (buffer) => {
            this.engineSound.setBuffer(buffer);
            this.engineSound.setLoop(true);
            this.engineSound.setVolume(0.3);
        });
        audioLoader.load('./sfx_grapple_shoot.mp3', (buffer) => {
            this.grappleSound.setBuffer(buffer);
            this.grappleSound.setVolume(0.5);
        });
        audioLoader.load('./sfx_skid.mp3', (buffer) => {
            this.skidSound.setBuffer(buffer);
            this.skidSound.setVolume(0.4);
        });
    }

    start() {
        this.reset();
        this.loop();
    }

    reset() {
        // Clear scene
        while(this.scene.children.length > 0){ 
            this.scene.remove(this.scene.children[0]); 
        }
        this.explosions = [];

        // Cleanup previous replay video
        const video = document.getElementById('replay-video');
        if (video) {
            video.pause();
            video.currentTime = 0;
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            video.removeAttribute('src');
            video.load();
        }

        // Stop any previous recording just in case
        if (this.replayRecorder && this.replayRecorder.isRecording) {
            this.replayRecorder.stop().then(url => {
                if (url) URL.revokeObjectURL(url);
            });
        }

        // Re-add lights
        this.addLights();

        if (this.spaceEnvironment) {
             this.spaceEnvironment.reset();
             this.scene.add(this.spaceEnvironment.stars);
        } else {
             this.spaceEnvironment = new SpaceEnvironment(this.scene);
        }

        this.trackManager = new TrackManager(this.scene);
        this.car = new Car(this.scene);

        this.isRunning = true;
        this.isCrashing = false;
        this.explosionTriggered = false;
        this.interceptorSpawned = false;
        this.gameOverScreen.classList.add('hidden');
        this.distanceTraveled = 0;
        this.clock = new THREE.Clock();

        // Start new recording
        if (this.replayRecorder) {
            this.replayRecorder.start();
        }

        if (this.engineSound.buffer && !this.engineSound.isPlaying) this.engineSound.play();
    }

    gameOver() {
        this.isRunning = false;
        this.isCrashing = true;
        this.explosionTriggered = false;
        this.interceptorSpawned = false;
        
        // Initial fall velocity: Preserve some forward speed, add downward force
        this.fallVelocity = this.car.direction.clone().multiplyScalar(20);
        this.fallVelocity.y = -10;

        if (this.engineSound.isPlaying) this.engineSound.stop();
    }

    updateCrash(dt) {
        if (!this.explosionTriggered) {
            // Gravity
            this.fallVelocity.y -= 80 * dt; 
            
            // Apply velocity
            this.car.position.add(this.fallVelocity.clone().multiplyScalar(dt));
            this.car.mesh.position.copy(this.car.position);
            
            // Tumble rotation
            this.car.mesh.rotation.x += 5 * dt;
            this.car.mesh.rotation.z += 3 * dt;

            // Spawn Interceptor if falling deep enough
            if (!this.interceptorSpawned && this.car.position.y < -5) {
                this.spaceEnvironment.spawnInterceptor(this.car.position, this.fallVelocity);
                this.interceptorSpawned = true;
            }

            // Check Collision with Asteroids
            const hit = this.spaceEnvironment.checkCollisions(this.car.position);
            
            // Trigger explosion on hit OR failsafe depth
            if (hit || this.car.position.y < -200) {
                this.triggerExplosion();
            }
        }

        // Camera follow
        // Pull back further to show the fall and surroundings (asteroids)
        const targetCamPos = this.car.position.clone().add(new THREE.Vector3(0, 60, 40));
        
        // Slower camera follow during explosion for cinematic effect
        const lerpSpeed = this.explosionTriggered ? dt * 2 : dt * 3;
        this.camera.position.lerp(targetCamPos, lerpSpeed);
        this.camera.lookAt(this.car.position);
    }

    triggerExplosion() {
        this.explosionTriggered = true;

        // Spawn Explosion at current car position
        const explosion = new Explosion(this.scene, this.car.position.clone());
        this.explosions.push(explosion);
        
        // Hide car mesh as it exploded
        this.car.hide();

        // Play explosion sound (repurposed skidSound)
        if (this.skidSound.buffer) {
            if (this.skidSound.isPlaying) this.skidSound.stop();
            this.skidSound.setVolume(1.0);
            this.skidSound.play();
        }

        // Delay showing game over overlay so explosion is visible
        setTimeout(() => {
            this.showGameOverScreen();
            this.isCrashing = false;
        }, 2500);
    }

    async showGameOverScreen() {
        this.gameOverScreen.classList.remove('hidden');
        this.finalScoreEl.innerText = `Distance: ${Math.floor(this.distanceTraveled)}m`;

        // Stop recording and load replay
        if (this.replayRecorder) {
            const url = await this.replayRecorder.stop();
            if (url) {
                // Check if the game over screen is still active before playing
                // (Prevents video from starting if user clicked retry during processing)
                if (!this.gameOverScreen.classList.contains('hidden')) {
                    const video = document.getElementById('replay-video');
                    video.src = url;
                    video.play().catch(e => console.log('Replay autoplay blocked:', e));
                } else {
                    URL.revokeObjectURL(url);
                }
            }
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    loop() {
        requestAnimationFrame(() => this.loop());

        const dt = Math.min(this.clock.getDelta(), 0.1); // Cap dt

        if (this.spaceEnvironment) {
            this.spaceEnvironment.update(dt, this.camera.position);
        }

        // Update Explosions
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.update(dt);
            if (!exp.alive) {
                this.explosions.splice(i, 1);
            }
        }

        if (this.isRunning) {
            // Update Logic
            this.car.update(dt, this.input, this.trackManager);

            // Check Track generation
            const distToHead = this.car.position.distanceTo(this.trackManager.currentPos);
            if (distToHead < 100) {
                this.trackManager.generateNextSegment();
            }

            // Check collision/Off-road
            // Use car's internal grounded state + safety check
            // We allow being airborn briefly (grappling or jumping), so check y threshold too
            
            if (!this.car.isGrounded && this.car.grappleState === 'IDLE') {
                // If not grappling and not on ground...
                // Only die if we fall significantly below where the track *should* be
                // But we don't know where track is.
                // Just check absolute fall depth relative to last known good Y?
                // Or just if Y < -50 (assuming start at 0) - but track goes up/down now.
                
                // Better: If Raycast missed (car.isGrounded is false) AND we have fallen for a while?
                // Or if we are far below the nearest track piece?
                
                // Let's use a "Grace Period" or check vertical velocity falling
                if (this.car.position.y < -50 && !this.car.isGrounded) {
                     // We might be just low on the track?
                     // TrackManager now supports slopes.
                     // Let's use a robust "Death Plane" relative to the nearest track segment.
                     
                     // Fallback to simple check:
                     // If we are not grounded, and we have been falling for X frames?
                     // Or simply: check distance to nearest track point.
                     
                     // Optimization: The track manager knows the segments.
                     // But calculating nearest point on all segments is slow.
                     
                     // Since car.isGrounded is reliable (it casts down 15 units), 
                     // if !isGrounded for a prolonged time, we are off.
                     // But jumping/falling takes time.
                     
                     // Let's rely on the car falling deep.
                     // Assuming track doesn't go below -100 generally without slope.
                     // But track can go to -1000.
                     
                     // Re-use logic: If !isGrounded, allow fall until impact or death.
                     // Death condition: Car Y is significantly below the *last known* ground Y.
                     // But we don't store that.
                     
                     // Let's just assume if we fall 30 units below the raycast origin without hit, we are dead.
                     // But raycast follows car.
                     
                     // Simple solution: If we intersect nothing with a VERY long ray down?
                     // Raycast 100 units down. If nothing, dead.
                     
                     const deepRay = new THREE.Raycaster(this.car.position, new THREE.Vector3(0,-1,0));
                     deepRay.far = 50;
                     const hits = deepRay.intersectObjects(this.trackManager.trackGroup.children);
                     
                     if (hits.length === 0) {
                         // No track below us for 50 meters
                         this.gameOver();
                     }
                }
            }
            
            // OriginalisOnTrack check is removed/replaced by above logic.

            // Update Score
            this.distanceTraveled += this.car.speed * dt;
            this.scoreEl.innerText = `DISTANCE: ${Math.floor(this.distanceTraveled)}m`;
            this.grappleScoreEl.innerText = `GRAPPLES: ${this.car.grappleCount}`;

            // Camera Follow (Smooth)
            // Target pos: car pos + offset rotated by car direction? 
            // Or just overhead? "Top down" usually implies fixed orientation.
            // Let's do fixed orientation top-down but following position.

            const targetCamPos = this.car.position.clone().add(new THREE.Vector3(0, 30, 20)); // High angle looking down
            this.camera.position.lerp(targetCamPos, dt * 5);
            this.camera.lookAt(this.car.position);

            // SFX Logic
            if(this.car.grappleState === 'FIRING' && !this.grappleSound.isPlaying && this.grappleSound.buffer) {
                this.grappleSound.play();
            }
        } else if (this.isCrashing) {
            this.updateCrash(dt);
        }

        this.composer.render();
    }
}