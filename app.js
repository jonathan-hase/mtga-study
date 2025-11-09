// ==================== CONFIGURATION ====================
const CONFIG = {
    // Card physical dimensions (standard TCG card)
    cardWidthMM: 63,
    cardHeightMM: 88,

    // Visual effects
    maxStackCards: 5,
    stackRotationRange: 10,      // ±5 degrees
    stackOffsetRange: 60,         // ±30 pixels
    stackDarkenPerLayer: 0.25,    // 5% darkening per layer
    minCardMargin: 0,            // Minimum margin in pixels around card (all sides)

    // Animation timings (milliseconds)
    throwDuration: 400,
    settleDuration: 200,

    // Throw animation
    throwDistanceMin: 2.5,
    throwDistanceMax: 3.0,
    throwRotationRange: 720,      // ±360 degrees

    // Depth values for WebGPU depth testing
    depthCurrent: 0.1,
    depthStackBase: 0.5,
    // depthStackIncrement is calculated dynamically to fit all stack cards in range 0.5-1.0

    // Persistence
    cookieName: 'cardStudyProgress',
    cookieExpireDays: 365,

    // Preloading (should match maxStackCards to show full stack)
    get preloadCount() {
        return this.maxStackCards;
    },

    // Computed values (do not modify directly)
    get depthStackIncrement() {
        return (1.0 - this.depthStackBase) / this.maxStackCards;
    }
};

// ==================== UTILITY FUNCTIONS ====================
class Utils {
    static fisherYatesShuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    static setCookie(name, value, days) {
        const expires = new Date();
        expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
    }

    static getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    static easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    // CRITICAL: Keep exact same signature including depth parameter
    static createTransformMatrix(canvas, cardWidth, cardHeight, offsetX, offsetY, scale, rotationDeg, depth) {
        const rad = (rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // CRITICAL FIX: Divide by DPI to compensate for WebGPU viewport on high-DPI displays
        // WebGPU on Safari/iOS uses physical canvas size for viewport, so we need to
        // scale down by DPI to get correct visual size
        const dpi = window.devicePixelRatio || 1;

        // Card dimensions are in CSS pixels, canvas dimensions are in CSS pixels
        // * 2 needed to convert to NDC space (quad spans from -1 to +1 = 2 units)
        // / dpi compensates for physical viewport on high-DPI displays
        const scaleX = (cardWidth / canvas.width) * 2 * scale / dpi;
        const scaleY = (cardHeight / canvas.height) * 2 * scale / dpi;

        // WebGPU uses column-major matrices
        // Standard 2D rotation with non-uniform scale applied before rotation:
        // Column 0: [cos*scaleX, sin*scaleX] - rotated & scaled X basis vector
        // Column 1: [-sin*scaleY, cos*scaleY] - rotated & scaled Y basis vector
        return new Float32Array([
            cos * scaleX,  sin * scaleX,  0, 0,  // Column 0
            -sin * scaleY, cos * scaleY,  0, 0,  // Column 1
            0, 0, 1, 0,                           // Column 2
            offsetX, offsetY, depth, 1            // Column 3 (translation)
        ]);
    }
}

// ==================== STATE MANAGER ====================
class StateManager {
    constructor(totalCards) {
        this.totalCards = totalCards;
        this.shuffledIndices = [];
        this.currentCardIndex = 0;
    }

    load() {
        const saved = Utils.getCookie(CONFIG.cookieName);
        if (saved) {
            try {
                const state = JSON.parse(saved);
                this.shuffledIndices = state.indices;
                this.currentCardIndex = state.current;

                if (this.shuffledIndices.length !== this.totalCards) {
                    throw new Error('Invalid saved state');
                }
            } catch (e) {
                this.reset();
            }
        } else {
            this.reset();
        }
    }

    save() {
        const state = {
            indices: this.shuffledIndices,
            current: this.currentCardIndex
        };
        Utils.setCookie(CONFIG.cookieName, JSON.stringify(state), CONFIG.cookieExpireDays);
    }

    reset() {
        this.shuffledIndices = Array.from({ length: this.totalCards }, (_, i) => i);
        Utils.fisherYatesShuffle(this.shuffledIndices);
        this.currentCardIndex = 0;
        this.save();
    }

    advance() {
        this.currentCardIndex++;
        if (this.currentCardIndex >= this.shuffledIndices.length) {
            return false; // Deck complete
        }
        this.save();
        return true;
    }

    getCurrentCardPath(cards) {
        return cards[this.shuffledIndices[this.currentCardIndex]];
    }

    getStackCardPath(cards, offset) {
        const idx = this.currentCardIndex + offset;
        if (idx < this.shuffledIndices.length) {
            return cards[this.shuffledIndices[idx]];
        }
        return null;
    }

    getRemainingCards() {
        return this.shuffledIndices.length - this.currentCardIndex;
    }
}

// ==================== MAIN APPLICATION ====================
// Card Study Application with WebGPU
class CardStudyApp {
    constructor() {
        this.canvas = document.getElementById('cardCanvas');
        this.loadingEl = document.getElementById('loading');
        this.errorEl = document.getElementById('error');

        this.cards = [];
        this.stateManager = null;
        this.isAnimating = false;
        this.animationProgress = 0;
        this.throwDirection = { x: 0, y: 0 };
        this.throwRotation = 0;

        // Card dimensions in mm
        this.cardWidthMM = CONFIG.cardWidthMM;
        this.cardHeightMM = CONFIG.cardHeightMM;

        // Stack effect properties
        this.cardRotations = []; // Random rotations for cards in stack
        this.cardOffsets = []; // Random offsets for cards in stack
        this.cardDarkenFactors = []; // Previous darken factors for animating brightness changes
        this.currentCardInitialRotation = 0; // Initial rotation when card becomes current
        this.currentCardInitialOffset = { x: 0, y: 0 }; // Initial offset when card becomes current
        this.isSettling = false; // Whether current card is settling into position
        this.settleProgress = 1.0; // Progress of settle animation (0 to 1)

        // Snapshots of stack arrays during settle animation (prevents race condition)
        this.settleStackRotations = [];
        this.settleStackOffsets = [];
        this.settleStackDarkenFactors = [];
        this.isLoadingStackCard = false; // Flag to prevent concurrent array modifications

        // WebGPU resources
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.textureCache = new Map();
        this.currentTexture = null;
        this.nextTextures = [];

        this.init();
    }

    async init() {
        try {
            await this.checkWebGPU();
            await this.loadCardList();

            this.stateManager = new StateManager(this.cards.length);
            this.stateManager.load();

            await this.initWebGPU();
            await this.setupCanvas();
            await this.loadCurrentCards();
            this.setupEventListeners();
            this.loadingEl.style.display = 'none';
            this.render();
        } catch (error) {
            this.showError(error.message);
        }
    }

    async checkWebGPU() {
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in your browser. Please use Chrome/Edge 113+ or another WebGPU-capable browser.');
        }
    }

    async loadCardList() {
        // Load the list of all card files
        const response = await fetch('cards.json');
        if (!response.ok) {
            throw new Error('Failed to load card list. Please ensure cards.json exists.');
        }
        this.cards = await response.json();

        if (this.cards.length === 0) {
            throw new Error('No cards found in the card list.');
        }
    }

    async initWebGPU() {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('Failed to get WebGPU adapter');
        }

        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu');

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: presentationFormat,
            alphaMode: 'premultiplied',
        });

        // Create depth texture for depth testing
        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        await this.createPipeline(presentationFormat);
    }

    async createPipeline(format) {
        const shaderCode = `
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) texCoord: vec2<f32>,
            }

            struct Uniforms {
                transform: mat4x4<f32>,
                opacity: f32,
                depth: f32,
                darkenFactor: f32,
                padding: f32,
            }

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var textureSampler: sampler;
            @group(0) @binding(2) var textureData: texture_2d<f32>;

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var pos = array<vec2<f32>, 6>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(1.0, -1.0),
                    vec2<f32>(1.0, 1.0),
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(1.0, 1.0),
                    vec2<f32>(-1.0, 1.0)
                );

                var texCoord = array<vec2<f32>, 6>(
                    vec2<f32>(0.0, 1.0),
                    vec2<f32>(1.0, 1.0),
                    vec2<f32>(1.0, 0.0),
                    vec2<f32>(0.0, 1.0),
                    vec2<f32>(1.0, 0.0),
                    vec2<f32>(0.0, 0.0)
                );

                var output: VertexOutput;
                let transformed = uniforms.transform * vec4<f32>(pos[vertexIndex], 0.0, 1.0);
                output.position = vec4<f32>(transformed.xy, uniforms.depth, transformed.w);
                output.texCoord = texCoord[vertexIndex];
                return output;
            }

            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                let color = textureSample(textureData, textureSampler, input.texCoord);
                // Apply darkening tint to background cards
                let darkenedColor = color.rgb * uniforms.darkenFactor;
                return vec4<f32>(darkenedColor, color.a * uniforms.opacity);
            }
        `;

        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: format,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
            depthStencil: {
                format: 'depth32float',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
    }

    setupCanvas() {
        const updateSize = () => {
            const dpi = window.devicePixelRatio || 1;

            // Calculate card size in CSS pixels (96 DPI = 1 inch = 25.4mm)
            // NOTE: Don't multiply by devicePixelRatio here - that's only for canvas resolution
            const mmToCssPixel = 96 / 25.4;
            const cardWidthCss = this.cardWidthMM * mmToCssPixel;
            const cardHeightCss = this.cardHeightMM * mmToCssPixel;

            // Ensure the card fits on screen with minimum margin on all sides
            const margin = CONFIG.minCardMargin;
            const maxWidth = window.innerWidth - (margin * 2);
            const maxHeight = window.innerHeight - (margin * 2);

            // Scaling logic:
            // - Mobile (< 400px width): Scale to fill available width (ignore natural size)
            // - Desktop: Keep natural size unless too large, then scale down
            let scale = 1;
            if (window.innerWidth < 400) {
                // Mobile: Scale card to fill width with margins
                const scaleByWidth = maxWidth / cardWidthCss;
                const scaleByHeight = maxHeight / cardHeightCss;
                scale = Math.min(scaleByWidth, scaleByHeight);
                console.log(`[setupCanvas] Mobile view (${window.innerWidth}px), scaling to fit: ${scale.toFixed(4)}`);
            } else if (cardWidthCss > maxWidth || cardHeightCss > maxHeight) {
                // Desktop: Only scale down if card is too large
                const scaleByWidth = maxWidth / cardWidthCss;
                const scaleByHeight = maxHeight / cardHeightCss;
                scale = Math.min(scaleByWidth, scaleByHeight);
                console.log(`[setupCanvas] Card too large, scaling down: ${scale.toFixed(4)}`);
            } else {
                console.log(`[setupCanvas] Card fits, keeping natural size (scale: 1.0)`);
            }

            // Store card dimensions in CSS pixels for transform calculations
            this.cardWidth = cardWidthCss * scale;
            this.cardHeight = cardHeightCss * scale;

            // DEBUG: Log the values
            console.log(`[setupCanvas] DPI: ${dpi}, innerWidth: ${window.innerWidth}, innerHeight: ${window.innerHeight}`);
            console.log(`[setupCanvas] cardWidthCss: ${cardWidthCss.toFixed(2)}, cardHeightCss: ${cardHeightCss.toFixed(2)}`);
            console.log(`[setupCanvas] margin: ${margin}, maxWidth: ${maxWidth}, maxHeight: ${maxHeight}`);
            console.log(`[setupCanvas] scale: ${scale.toFixed(4)}`);
            console.log(`[setupCanvas] final cardWidth: ${this.cardWidth.toFixed(2)}, cardHeight: ${this.cardHeight.toFixed(2)}`);
            console.log(`[setupCanvas] canvasWidthCss: ${this.canvasWidthCss}, canvasHeightCss: ${this.canvasHeightCss}`);

            this.canvas.width = window.innerWidth * dpi;
            this.canvas.height = window.innerHeight * dpi;
            this.canvas.style.width = `${window.innerWidth}px`;
            this.canvas.style.height = `${window.innerHeight}px`;

            // Recreate depth texture with new canvas dimensions
            if (this.device && this.depthTexture) {
                this.depthTexture.destroy();
                this.depthTexture = this.device.createTexture({
                    size: [this.canvas.width, this.canvas.height],
                    format: 'depth32float',
                    usage: GPUTextureUsage.RENDER_ATTACHMENT,
                });
            }
        };

        updateSize();
        window.addEventListener('resize', updateSize);
    }

    async loadCurrentCards() {
        console.log(`[loadCurrentCards] Loading card ${this.stateManager.currentCardIndex}`);

        // Load current card
        const currentCardPath = this.stateManager.getCurrentCardPath(this.cards);
        this.currentTexture = await this.loadTexture(currentCardPath);
        console.log(`[loadCurrentCards] Current card loaded: ${currentCardPath}`);

        // Load next few cards for the stack effect (in parallel for speed)
        this.nextTextures = [];
        this.cardRotations = [];
        this.cardOffsets = [];
        const cardsToPreload = Math.min(CONFIG.preloadCount, this.stateManager.getRemainingCards());
        console.log(`[loadCurrentCards] Preloading ${cardsToPreload} stack cards`);

        // Build array of promises to load in parallel
        const loadPromises = [];
        for (let i = 1; i <= cardsToPreload; i++) {
            const cardPath = this.stateManager.getStackCardPath(this.cards, i);
            if (cardPath) {
                loadPromises.push(this.loadTexture(cardPath));

                // Generate random rotation for this card (-5 to +5 degrees)
                const rotation = (Math.random() - 0.5) * CONFIG.stackRotationRange;
                this.cardRotations.push(rotation);

                // Generate random offset for this card (pixels - will be converted to normalized coords later)
                // CRITICAL: Scale offsets proportionally to screen size to maintain consistent visual appearance
                // Base values designed for 1920×1080 desktop screens
                const baseScreenWidth = 1920;
                const baseScreenHeight = 1080;
                const screenRatio = Math.min(window.innerWidth / baseScreenWidth, window.innerHeight / baseScreenHeight);

                const offsetX = (Math.random() - 0.5) * CONFIG.stackOffsetRange * screenRatio;
                const offsetY = (Math.random() - 0.5) * CONFIG.stackOffsetRange * screenRatio;
                this.cardOffsets.push({ x: offsetX, y: offsetY });
            }
        }

        // Wait for all textures to load in parallel
        this.nextTextures = await Promise.all(loadPromises);
        console.log(`[loadCurrentCards] Stack loaded: ${this.nextTextures.length} cards`);
    }

    async loadTexture(path) {
        if (this.textureCache.has(path)) {
            return this.textureCache.get(path);
        }

        const response = await fetch(path);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        const texture = this.device.createTexture({
            size: [imageBitmap.width, imageBitmap.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: texture },
            [imageBitmap.width, imageBitmap.height]
        );

        this.textureCache.set(path, texture);
        return texture;
    }

    setupEventListeners() {
        const handleInteraction = (e) => {
            e.preventDefault();
            if (!this.isAnimating) {
                this.throwCard();
            }
        };

        this.canvas.addEventListener('click', handleInteraction);
        this.canvas.addEventListener('touchstart', handleInteraction, { passive: false });
    }

    throwCard() {
        this.isAnimating = true;
        this.animationProgress = 0;

        // Random throw direction
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.throwDistanceMin + Math.random() * (CONFIG.throwDistanceMax - CONFIG.throwDistanceMin);
        this.throwDirection = {
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance
        };

        // Random rotation direction
        this.throwRotation = (Math.random() - 0.5) * CONFIG.throwRotationRange; // -360 to 360 degrees

        this.animateThrow();
    }

    animateThrow() {
        const duration = CONFIG.throwDuration; // ms
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            this.animationProgress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = Utils.easeOutCubic(this.animationProgress);

            this.render();

            if (this.animationProgress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.onCardThrowComplete();
            }
        };

        requestAnimationFrame(animate);
    }

    async onCardThrowComplete() {
        this.isAnimating = false;
        console.log(`[onCardThrowComplete] Card thrown, advancing from ${this.stateManager.currentCardIndex}`);
        console.log(`[onCardThrowComplete] Stack state before: ${this.nextTextures.length} cards, rotations: ${this.cardRotations.length}, offsets: ${this.cardOffsets.length}`);

        // Capture the rotation/offset of the next card BEFORE advancing
        // The next card (currently at index 0 of stack arrays) will become the current card
        const nextCardRotation = this.cardRotations.length > 0 ? this.cardRotations[0] : 0;

        // Use only the random offset (no systematic offset)
        let nextCardOffset = { x: 0, y: 0 };
        if (this.cardOffsets.length > 0) {
            nextCardOffset = {
                x: this.cardOffsets[0].x,
                y: this.cardOffsets[0].y
            };
        }
        console.log(`[onCardThrowComplete] Next card rotation: ${nextCardRotation}°, offset: (${nextCardOffset.x.toFixed(1)}, ${nextCardOffset.y.toFixed(1)})px`);

        // Calculate and save old darken factors BEFORE incrementing index
        // This captures the current stack positions before the shift
        this.cardDarkenFactors = this.nextTextures.map((_, i) => {
            const oldStackLayer = i + 1; // 1 for front card (i=0), 2 for next (i=1), etc.
            return 1.0 - (oldStackLayer * CONFIG.stackDarkenPerLayer);
        });

        const hasMore = this.stateManager.advance();

        if (!hasMore) {
            console.log(`[onCardThrowComplete] Deck complete, reshuffling`);
            // Reshuffle
            this.stateManager.reset();
            await this.loadCurrentCards();
        } else {

            // Move the first card from stack to current (it's already loaded!)
            if (this.nextTextures.length > 0) {
                console.log(`[onCardThrowComplete] Using preloaded card from stack`);
                this.currentTexture = this.nextTextures[0];

                // Shift all arrays including darken factors
                this.nextTextures.shift();
                this.cardRotations.shift();
                this.cardOffsets.shift();
                this.cardDarkenFactors.shift(); // Remove the front card's old darken factor

                console.log(`[onCardThrowComplete] Stack state after shift: ${this.nextTextures.length} cards`);

                // Create snapshots of current stack arrays BEFORE loading new card
                // This prevents race condition where loadNextStackCard() modifies arrays during settle animation
                this.settleStackRotations = [...this.cardRotations];
                this.settleStackOffsets = [...this.cardOffsets];
                this.settleStackDarkenFactors = [...this.cardDarkenFactors];

                // Load one new card at the end of the stack (async, don't wait)
                this.isLoadingStackCard = true;
                this.loadNextStackCard().then(() => {
                    this.isLoadingStackCard = false;
                    console.log(`[onCardThrowComplete] Stack card loaded, flag cleared`);
                }).catch(err => {
                    this.isLoadingStackCard = false;
                    console.error(`[onCardThrowComplete] Error loading stack card:`, err);
                });
            } else {
                console.warn(`[onCardThrowComplete] Stack was empty! Falling back to full load`);
                // Fallback: no cards in stack, load normally
                await this.loadCurrentCards();
            }
        }

        // Start settle animation only if there was a card in the stack to animate from
        // (Skip on first card or when stack was empty)
        if (nextCardRotation !== 0 || nextCardOffset.x !== 0 || nextCardOffset.y !== 0) {
            console.log(`[onCardThrowComplete] Starting settle animation`);
            this.currentCardInitialRotation = nextCardRotation;
            this.currentCardInitialOffset = nextCardOffset;
            this.isSettling = true;
            this.settleProgress = 0;
            this.animateSettle();
        } else {
            console.log(`[onCardThrowComplete] Skipping settle animation, just rendering`);
            // No animation needed, just render
            this.render();
        }
    }

    async loadNextStackCard() {
        // Load one additional card at the end of the stack
        const nextIdx = this.stateManager.currentCardIndex + this.nextTextures.length + 1;
        console.log(`[loadNextStackCard] Loading card at index ${nextIdx}`);

        const cardPath = this.stateManager.getStackCardPath(this.cards, this.nextTextures.length + 1);
        if (cardPath) {
            const texture = await this.loadTexture(cardPath);
            this.nextTextures.push(texture);

            // Generate random rotation and offset for new card
            const rotation = (Math.random() - 0.5) * CONFIG.stackRotationRange;
            this.cardRotations.push(rotation);

            // CRITICAL: Scale offsets proportionally to screen size to maintain consistent visual appearance
            // Base values designed for 1920×1080 desktop screens
            const baseScreenWidth = 1920;
            const baseScreenHeight = 1080;
            const screenRatio = Math.min(window.innerWidth / baseScreenWidth, window.innerHeight / baseScreenHeight);

            const offsetX = (Math.random() - 0.5) * CONFIG.stackOffsetRange * screenRatio;
            const offsetY = (Math.random() - 0.5) * CONFIG.stackOffsetRange * screenRatio;
            this.cardOffsets.push({ x: offsetX, y: offsetY });

            // New cards have no old brightness to animate from, so mark as null
            // They will appear at their correct darkness immediately
            this.cardDarkenFactors.push(null);

            console.log(`[loadNextStackCard] Added to stack. New stack size: ${this.nextTextures.length}`);
        } else {
            console.log(`[loadNextStackCard] No more cards to load (reached end of deck)`);
        }
    }

    animateSettle() {
        const duration = CONFIG.settleDuration; // ms
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            this.settleProgress = Math.min(elapsed / duration, 1);

            this.render();

            if (this.settleProgress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.isSettling = false;
                this.settleProgress = 1.0;
            }
        };

        requestAnimationFrame(animate);
    }

    createTransformMatrix(offsetX, offsetY, scale, rotationDeg, depth) {
        // Use CSS display size (how the canvas appears on screen)
        // DPI compensation happens in Utils.createTransformMatrix
        const cssCanvas = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        // DEBUG: Log transform parameters (only for current card at center)
        if (offsetX === 0 && offsetY === 0 && rotationDeg === 0) {
            const dpi = window.devicePixelRatio || 1;
            console.log(`[createTransformMatrix] DPI: ${dpi}`);
            console.log(`[createTransformMatrix] canvas CSS size: ${cssCanvas.width}x${cssCanvas.height} px`);
            console.log(`[createTransformMatrix] canvas physical size: ${this.canvas.width}x${this.canvas.height} px`);
            console.log(`[createTransformMatrix] card: ${this.cardWidth.toFixed(2)}x${this.cardHeight.toFixed(2)} (CSS pixels)`);
            console.log(`[createTransformMatrix] scale: ${scale}, rotation: ${rotationDeg}`);
        }

        return Utils.createTransformMatrix(
            cssCanvas,
            this.cardWidth,
            this.cardHeight,
            offsetX, offsetY, scale, rotationDeg, depth
        );
    }

    render() {
        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);

        // Render from BACK TO FRONT for proper alpha blending
        // First render stack cards (furthest back first), then current card (front)

        const remaining = this.stateManager.getRemainingCards();
        const maxStack = CONFIG.maxStackCards;
        const stackSize = Math.min(maxStack, remaining - 1);

        console.log(`[render] Rendering ${stackSize} stack cards from ${this.nextTextures.length} available`);

        // Render stack from back to front (i = stackSize-1 down to 0)
        for (let i = stackSize - 1; i >= 0; i--) {
            if (i < this.nextTextures.length) {
                // Depth for layering (with depth testing: smaller = closer, larger = further)
                // Stack cards are further back, so they get larger depth values
                const depth = CONFIG.depthStackBase + (i * CONFIG.depthStackIncrement);

                // Use random offsets only - no systematic bias
                // This allows cards to peek from all directions
                const stackLayer = i + 1; // 1 for front card (i=0), 2 for next (i=1), etc.

                // CRITICAL: Use snapshot arrays during settle animation to prevent race condition
                // When settle is active, loadNextStackCard() might be modifying live arrays
                const useSnapshots = this.isSettling;
                const rotationsArray = useSnapshots ? this.settleStackRotations : this.cardRotations;
                const offsetsArray = useSnapshots ? this.settleStackOffsets : this.cardOffsets;
                const darkenArray = useSnapshots ? this.settleStackDarkenFactors : this.cardDarkenFactors;

                // Use only the random offset (no systematic offset to force direction)
                const pixelOffset = offsetsArray[i] || { x: 0, y: 0 };
                const totalOffsetX = pixelOffset.x;
                const totalOffsetY = pixelOffset.y;

                // Convert to normalized coordinates (-1 to 1 range)
                // Use CSS dimensions (window.innerWidth/Height) to match transform calculations
                const normalizedOffsetX = (totalOffsetX / window.innerWidth) * 2;
                const normalizedOffsetY = (totalOffsetY / window.innerHeight) * 2;

                // Rotation from stored random rotation
                const rotation = rotationsArray[i] || 0;

                // Scale: all cards same size (100%)
                const scale = 1.0;

                // Darkening: animate brightness changes when cards move in stack
                let darkenFactor;
                if (this.isSettling && i < darkenArray.length && darkenArray[i] !== null) {
                    // Animate from old brightness to new brightness (card was in stack before)
                    const oldDarken = darkenArray[i];
                    const newDarken = 1.0 - (stackLayer * CONFIG.stackDarkenPerLayer);
                    const eased = Utils.easeOutCubic(this.settleProgress); // Ease out cubic
                    darkenFactor = oldDarken + (newDarken - oldDarken) * eased;
                } else {
                    // Static darkening based on stack position (new cards or not settling)
                    darkenFactor = 1.0 - (stackLayer * CONFIG.stackDarkenPerLayer);
                }

                console.log(`[render] Stack card ${i}: offset=(${totalOffsetX.toFixed(1)}, ${totalOffsetY.toFixed(1)})px, normalized=(${normalizedOffsetX.toFixed(3)}, ${normalizedOffsetY.toFixed(3)}), rotation=${rotation.toFixed(1)}°, scale=${scale.toFixed(2)}, darken=${darkenFactor.toFixed(2)}, depth=${depth.toFixed(2)}`);

                // Calculate visibility: hide cards when approaching end
                let opacity = 1.0;
                if (remaining <= maxStack) {
                    const cardPosition = stackSize - i;
                    if (cardPosition >= remaining - 1) {
                        opacity = 0.0;
                    }
                }

                this.renderCard(
                    this.nextTextures[i],
                    normalizedOffsetX,
                    normalizedOffsetY,
                    scale,
                    rotation,
                    depth,
                    opacity,
                    darkenFactor,
                    passEncoder
                );
            }
        }

        // Render current card LAST (so it appears in front of stack)
        if (this.currentTexture) {
            let offsetX = 0;
            let offsetY = 0;
            let rotation = 0;
            let opacity = 1.0;
            let darken = 1.0;

            if (this.isAnimating) {
                // Throw animation
                const eased = Utils.easeOutCubic(this.animationProgress);
                offsetX = this.throwDirection.x * eased;
                offsetY = this.throwDirection.y * eased;
                rotation = this.throwRotation * eased;
                opacity = 1.0 - this.animationProgress;
            } else if (this.isSettling) {
                // Settle animation: smoothly rotate and move from stack position to center
                const eased = Utils.easeOutCubic(this.settleProgress); // Ease out cubic

                // Interpolate rotation from initial to 0
                rotation = this.currentCardInitialRotation * (1 - eased);

                // Interpolate offset from initial to 0
                const pixelOffsetX = this.currentCardInitialOffset.x * (1 - eased);
                const pixelOffsetY = this.currentCardInitialOffset.y * (1 - eased);
                // Use CSS dimensions (window.innerWidth/Height) to match transform calculations
                offsetX = (pixelOffsetX / window.innerWidth) * 2;
                offsetY = (pixelOffsetY / window.innerHeight) * 2;

                // Interpolate darkening from stack value to full brightness
                const initialDarken = 1.0 - CONFIG.stackDarkenPerLayer; // Same as first card in stack
                darken = initialDarken + (1.0 - initialDarken) * eased;
            }

            this.renderCard(
                this.currentTexture,
                offsetX,
                offsetY,
                1.0,
                rotation,
                CONFIG.depthCurrent, // Current card is closest (smallest depth value)
                opacity,
                darken,
                passEncoder
            );
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }

    renderCard(texture, offsetX, offsetY, scale, rotation, depth, opacity, darkenFactor, passEncoder) {
        const sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        const transformMatrix = this.createTransformMatrix(offsetX, offsetY, scale, rotation, depth);

        const uniformBuffer = this.device.createBuffer({
            size: 80, // mat4x4 (64 bytes) + float (4) + float (4) + float (4) + float (4)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const uniformData = new Float32Array(20);
        uniformData.set(transformMatrix, 0);
        uniformData[16] = opacity;
        uniformData[17] = depth;
        uniformData[18] = darkenFactor;
        uniformData[19] = 0; // padding

        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: sampler },
                { binding: 2, resource: texture.createView() },
            ],
        });

        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(6, 1, 0, 0);
    }

    showError(message) {
        this.loadingEl.style.display = 'none';
        this.errorEl.textContent = message;
        this.errorEl.style.display = 'block';
        console.error(message);
    }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new CardStudyApp());
} else {
    new CardStudyApp();
}
