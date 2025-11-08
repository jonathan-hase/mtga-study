// ==================== CONFIGURATION ====================
const CONFIG = {
    // Card physical dimensions (standard TCG card)
    cardWidthMM: 63,
    cardHeightMM: 88,

    // Visual effects
    maxStackCards: 5,
    stackRotationRange: 10,      // ±5 degrees
    stackOffsetRange: 60,         // ±30 pixels
    stackDarkenPerLayer: 0.15,    // 15% darkening per layer
    viewportCardLimit: 0.9,       // 90% of viewport max

    // Animation timings (milliseconds)
    throwDuration: 500,
    settleDuration: 300,

    // Throw animation
    throwDistanceMin: 2.5,
    throwDistanceMax: 3.0,
    throwRotationRange: 720,      // ±360 degrees

    // Depth values for WebGPU depth testing
    depthCurrent: 0.1,
    depthStackBase: 0.5,
    depthStackIncrement: 0.05,

    // Persistence
    cookieName: 'cardStudyProgress',
    cookieExpireDays: 365,

    // Preloading
    preloadCount: 5
};

// ==================== SHADER CODE ====================
const SHADER_CODE = `
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
        let darkenedColor = color.rgb * uniforms.darkenFactor;
        return vec4<f32>(darkenedColor, color.a * uniforms.opacity);
    }
`;

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

    static createTransformMatrix(canvas, cardWidth, cardHeight, offsetX, offsetY, scale, rotationDeg) {
        const rad = (rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const scaleX = (cardWidth / canvas.width) * 2 * scale;
        const scaleY = (cardHeight / canvas.height) * 2 * scale;

        return new Float32Array([
            cos * scaleX, sin * scaleX, 0, 0,
            -sin * scaleY, cos * scaleY, 0, 0,
            0, 0, 1, 0,
            offsetX, offsetY, 0, 1
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

// ==================== ANIMATION CONTROLLER ====================
class AnimationController {
    constructor() {
        this.isAnimating = false;
        this.animationType = null; // 'throw' or 'settle'
        this.progress = 0;
        this.startTime = 0;

        // Throw animation state
        this.throwDirection = { x: 0, y: 0 };
        this.throwRotation = 0;

        // Settle animation state
        this.settleFromRotation = 0;
        this.settleFromOffset = { x: 0, y: 0 };
    }

    startThrow() {
        this.isAnimating = true;
        this.animationType = 'throw';
        this.progress = 0;

        // Random throw direction
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.throwDistanceMin + Math.random() * (CONFIG.throwDistanceMax - CONFIG.throwDistanceMin);
        this.throwDirection = {
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance
        };

        // Random rotation direction
        this.throwRotation = (Math.random() - 0.5) * CONFIG.throwRotationRange;
    }

    startSettle(fromRotation, fromOffset) {
        this.isAnimating = true;
        this.animationType = 'settle';
        this.progress = 0;
        this.settleFromRotation = fromRotation;
        this.settleFromOffset = fromOffset;
    }

    update(currentTime) {
        if (!this.isAnimating) return false;

        if (this.startTime === 0) {
            this.startTime = currentTime;
        }

        const elapsed = currentTime - this.startTime;
        const duration = this.animationType === 'throw' ? CONFIG.throwDuration : CONFIG.settleDuration;
        this.progress = Math.min(elapsed / duration, 1);

        if (this.progress >= 1) {
            this.complete();
            return true; // Animation complete
        }

        return false;
    }

    complete() {
        this.isAnimating = false;
        this.progress = 1;
        this.startTime = 0;
    }

    getThrowTransform(cssWidth, cssHeight) {
        const eased = Utils.easeOutCubic(this.progress);
        return {
            offsetX: this.throwDirection.x * eased,
            offsetY: this.throwDirection.y * eased,
            rotation: this.throwRotation * eased,
            opacity: 1.0 - this.progress,
            darken: 1.0
        };
    }

    getSettleTransform(cssWidth, cssHeight) {
        const eased = Utils.easeOutCubic(this.progress);

        const pixelOffsetX = this.settleFromOffset.x * (1 - eased);
        const pixelOffsetY = this.settleFromOffset.y * (1 - eased);
        const offsetX = (pixelOffsetX / cssWidth) * 2;
        const offsetY = (pixelOffsetY / cssHeight) * 2;

        const rotation = this.settleFromRotation * (1 - eased);

        const initialDarken = 1.0 - CONFIG.stackDarkenPerLayer;
        const darken = initialDarken + (1.0 - initialDarken) * eased;

        return {
            offsetX,
            offsetY,
            rotation,
            opacity: 1.0,
            darken
        };
    }
}

// ==================== TEXTURE MANAGER ====================
class TextureManager {
    constructor(device) {
        this.device = device;
        this.cache = new Map();
    }

    async load(path) {
        if (this.cache.has(path)) {
            return this.cache.get(path);
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

        this.cache.set(path, texture);
        return texture;
    }

    has(path) {
        return this.cache.has(path);
    }

    get(path) {
        return this.cache.get(path);
    }
}

// ==================== CARD STACK ====================
class CardStack {
    constructor() {
        this.textures = [];
        this.rotations = [];
        this.offsets = [];
        this.oldDarkenFactors = [];
    }

    clear() {
        this.textures = [];
        this.rotations = [];
        this.offsets = [];
        this.oldDarkenFactors = [];
    }

    add(texture) {
        this.textures.push(texture);

        const rotation = (Math.random() - 0.5) * CONFIG.stackRotationRange;
        this.rotations.push(rotation);

        const offsetX = (Math.random() - 0.5) * CONFIG.stackOffsetRange;
        const offsetY = (Math.random() - 0.5) * CONFIG.stackOffsetRange;
        this.offsets.push({ x: offsetX, y: offsetY });

        this.oldDarkenFactors.push(null);
    }

    shift() {
        const front = {
            texture: this.textures[0],
            rotation: this.rotations[0],
            offset: this.offsets[0]
        };

        this.textures.shift();
        this.rotations.shift();
        this.offsets.shift();
        this.oldDarkenFactors.shift();

        return front;
    }

    saveOldDarkenFactors(remainingCards) {
        const stackSize = Math.min(CONFIG.maxStackCards, remainingCards - 1);
        this.oldDarkenFactors = this.textures.map((_, i) => {
            const oldStackLayer = stackSize - i;
            return 1.0 - (oldStackLayer * CONFIG.stackDarkenPerLayer);
        });
    }

    getCard(index) {
        return {
            texture: this.textures[index],
            rotation: this.rotations[index],
            offset: this.offsets[index],
            oldDarkenFactor: this.oldDarkenFactors[index]
        };
    }

    get length() {
        return this.textures.length;
    }
}

// ==================== WEBGPU RENDERER ====================
class WebGPURenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.depthTexture = null;
        this.sampler = null;
        this.uniformBuffer = null;

        this.cardWidth = 0;
        this.cardHeight = 0;
    }

    async initialize() {
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

        await this.createPipeline(presentationFormat);
        this.createDepthTexture();
        this.createSampler();
        this.createUniformBuffer();
        this.setupCanvas();
    }

    async createPipeline(format) {
        const shaderModule = this.device.createShaderModule({ code: SHADER_CODE });

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

    createDepthTexture() {
        if (this.depthTexture) {
            this.depthTexture.destroy();
        }

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    createSampler() {
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
    }

    createUniformBuffer() {
        // Reusable uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 80, // mat4x4 (64 bytes) + 4 floats (16 bytes)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    setupCanvas() {
        const updateSize = () => {
            const dpi = window.devicePixelRatio || 1;

            const mmToPixel = (96 / 25.4) * dpi;
            const cardWidthPx = CONFIG.cardWidthMM * mmToPixel;
            const cardHeightPx = CONFIG.cardHeightMM * mmToPixel;

            const maxWidth = window.innerWidth * CONFIG.viewportCardLimit;
            const maxHeight = window.innerHeight * CONFIG.viewportCardLimit;

            let scale = 1;
            if (cardWidthPx > maxWidth || cardHeightPx > maxHeight) {
                scale = Math.min(maxWidth / cardWidthPx, maxHeight / cardHeightPx);
            }

            this.cardWidth = cardWidthPx * scale;
            this.cardHeight = cardHeightPx * scale;

            this.canvas.width = window.innerWidth * dpi;
            this.canvas.height = window.innerHeight * dpi;
            this.canvas.style.width = `${window.innerWidth}px`;
            this.canvas.style.height = `${window.innerHeight}px`;

            this.createDepthTexture();
        };

        updateSize();
        window.addEventListener('resize', updateSize);
    }

    beginRenderPass(commandEncoder) {
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

        return commandEncoder.beginRenderPass(renderPassDescriptor);
    }

    renderCard(passEncoder, texture, offsetX, offsetY, scale, rotation, depth, opacity, darkenFactor) {
        const transformMatrix = Utils.createTransformMatrix(
            this.canvas, this.cardWidth, this.cardHeight,
            offsetX, offsetY, scale, rotation
        );

        const uniformData = new Float32Array(20);
        uniformData.set(transformMatrix, 0);
        uniformData[16] = opacity;
        uniformData[17] = depth;
        uniformData[18] = darkenFactor;
        uniformData[19] = 0; // padding

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: texture.createView() },
            ],
        });

        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(6, 1, 0, 0);
    }
}

// ==================== MAIN APPLICATION ====================
class CardStudyApp {
    constructor() {
        this.canvas = document.getElementById('cardCanvas');
        this.loadingEl = document.getElementById('loading');
        this.errorEl = document.getElementById('error');

        this.cards = [];
        this.stateManager = null;
        this.renderer = null;
        this.textureManager = null;
        this.animationController = new AnimationController();
        this.cardStack = new CardStack();

        this.currentTexture = null;

        this.init();
    }

    async init() {
        try {
            await this.checkWebGPU();
            await this.loadCardList();

            this.stateManager = new StateManager(this.cards.length);
            this.renderer = new WebGPURenderer(this.canvas);

            await this.renderer.initialize();
            this.textureManager = new TextureManager(this.renderer.device);

            this.stateManager.load();
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
        const response = await fetch('cards.json');
        if (!response.ok) {
            throw new Error('Failed to load card list. Please ensure cards.json exists.');
        }
        this.cards = await response.json();

        if (this.cards.length === 0) {
            throw new Error('No cards found in the card list.');
        }
    }

    async loadCurrentCards() {
        console.log(`[loadCurrentCards] Loading card ${this.stateManager.currentCardIndex}`);

        // Load current card
        const currentCardPath = this.stateManager.getCurrentCardPath(this.cards);
        this.currentTexture = await this.textureManager.load(currentCardPath);
        console.log(`[loadCurrentCards] Current card loaded: ${currentCardPath}`);

        // Load stack cards in parallel
        this.cardStack.clear();
        const cardsToPreload = Math.min(CONFIG.preloadCount, this.stateManager.getRemainingCards());
        console.log(`[loadCurrentCards] Preloading ${cardsToPreload} stack cards`);

        const loadPromises = [];
        for (let i = 1; i <= cardsToPreload; i++) {
            const cardPath = this.stateManager.getStackCardPath(this.cards, i);
            if (cardPath) {
                loadPromises.push(this.textureManager.load(cardPath));
            }
        }

        const textures = await Promise.all(loadPromises);
        textures.forEach(texture => this.cardStack.add(texture));

        console.log(`[loadCurrentCards] Stack loaded: ${this.cardStack.length} cards`);
    }

    async loadNextStackCard() {
        const nextIdx = this.stateManager.currentCardIndex + this.cardStack.length + 1;
        console.log(`[loadNextStackCard] Loading card at index ${nextIdx}`);

        const cardPath = this.stateManager.getStackCardPath(this.cards, this.cardStack.length + 1);
        if (cardPath) {
            const texture = await this.textureManager.load(cardPath);
            this.cardStack.add(texture);
            console.log(`[loadNextStackCard] Added to stack. New stack size: ${this.cardStack.length}`);
        } else {
            console.log(`[loadNextStackCard] No more cards to load (reached end of deck)`);
        }
    }

    setupEventListeners() {
        const handleInteraction = (e) => {
            e.preventDefault();
            if (!this.animationController.isAnimating) {
                this.throwCard();
            }
        };

        this.canvas.addEventListener('click', handleInteraction);
        this.canvas.addEventListener('touchstart', handleInteraction, { passive: false });
    }

    throwCard() {
        this.animationController.startThrow();
        this.animate();
    }

    animate(currentTime = 0) {
        const isComplete = this.animationController.update(currentTime);
        this.render();

        if (!isComplete) {
            requestAnimationFrame((time) => this.animate(time));
        } else if (this.animationController.animationType === 'throw') {
            this.onCardThrowComplete();
        }
    }

    async onCardThrowComplete() {
        console.log(`[onCardThrowComplete] Card thrown, advancing from ${this.stateManager.currentCardIndex}`);

        // Capture next card state before advancing
        const nextCard = this.cardStack.length > 0 ? this.cardStack.getCard(0) : null;
        const nextCardRotation = nextCard ? nextCard.rotation : 0;
        const nextCardOffset = nextCard ? nextCard.offset : { x: 0, y: 0 };

        // Save old darken factors for animation
        this.cardStack.saveOldDarkenFactors(this.stateManager.getRemainingCards());

        // Advance to next card
        const hasMore = this.stateManager.advance();

        if (!hasMore) {
            console.log(`[onCardThrowComplete] Deck complete, reshuffling`);
            this.stateManager.reset();
            await this.loadCurrentCards();
        } else {
            if (this.cardStack.length > 0) {
                console.log(`[onCardThrowComplete] Using preloaded card from stack`);
                const front = this.cardStack.shift();
                this.currentTexture = front.texture;

                // Load one new card at the end
                this.loadNextStackCard();
            } else {
                console.warn(`[onCardThrowComplete] Stack was empty! Falling back to full load`);
                await this.loadCurrentCards();
            }
        }

        // Start settle animation if needed
        if (nextCardRotation !== 0 || nextCardOffset.x !== 0 || nextCardOffset.y !== 0) {
            console.log(`[onCardThrowComplete] Starting settle animation`);
            this.animationController.startSettle(nextCardRotation, nextCardOffset);
            this.animate();
        } else {
            console.log(`[onCardThrowComplete] Skipping settle animation, just rendering`);
            this.render();
        }
    }

    render() {
        const commandEncoder = this.renderer.device.createCommandEncoder();
        const passEncoder = this.renderer.beginRenderPass(commandEncoder);
        passEncoder.setPipeline(this.renderer.pipeline);

        const remaining = this.stateManager.getRemainingCards();
        const stackSize = Math.min(CONFIG.maxStackCards, remaining - 1);

        // Render stack cards back-to-front
        for (let i = stackSize - 1; i >= 0; i--) {
            if (i < this.cardStack.length) {
                this.renderStackCard(passEncoder, i, stackSize, remaining);
            }
        }

        // Render current card
        if (this.currentTexture) {
            this.renderCurrentCard(passEncoder);
        }

        passEncoder.end();
        this.renderer.device.queue.submit([commandEncoder.finish()]);
    }

    renderStackCard(passEncoder, index, stackSize, remaining) {
        const card = this.cardStack.getCard(index);
        const depth = CONFIG.depthStackBase + (index * CONFIG.depthStackIncrement);
        const stackLayer = stackSize - index;

        // Convert pixel offset to normalized coordinates
        const cssWidth = parseInt(this.canvas.style.width);
        const cssHeight = parseInt(this.canvas.style.height);
        const normalizedOffsetX = (card.offset.x / cssWidth) * 2;
        const normalizedOffsetY = (card.offset.y / cssHeight) * 2;

        // Calculate darken factor with animation
        let darkenFactor;
        if (this.animationController.animationType === 'settle' &&
            this.animationController.isAnimating &&
            card.oldDarkenFactor !== null) {
            const oldDarken = card.oldDarkenFactor;
            const newDarken = 1.0 - (stackLayer * CONFIG.stackDarkenPerLayer);
            const eased = Utils.easeOutCubic(this.animationController.progress);
            darkenFactor = oldDarken + (newDarken - oldDarken) * eased;
        } else {
            darkenFactor = 1.0 - (stackLayer * CONFIG.stackDarkenPerLayer);
        }

        // Calculate visibility
        let opacity = 1.0;
        if (remaining <= CONFIG.maxStackCards) {
            const cardPosition = stackSize - index;
            if (cardPosition >= remaining - 1) {
                opacity = 0.0;
            }
        }

        this.renderer.renderCard(
            passEncoder,
            card.texture,
            normalizedOffsetX,
            normalizedOffsetY,
            1.0,
            card.rotation,
            depth,
            opacity,
            darkenFactor
        );
    }

    renderCurrentCard(passEncoder) {
        let offsetX = 0;
        let offsetY = 0;
        let rotation = 0;
        let opacity = 1.0;
        let darken = 1.0;

        const cssWidth = parseInt(this.canvas.style.width);
        const cssHeight = parseInt(this.canvas.style.height);

        if (this.animationController.isAnimating) {
            if (this.animationController.animationType === 'throw') {
                const transform = this.animationController.getThrowTransform(cssWidth, cssHeight);
                offsetX = transform.offsetX;
                offsetY = transform.offsetY;
                rotation = transform.rotation;
                opacity = transform.opacity;
                darken = transform.darken;
            } else if (this.animationController.animationType === 'settle') {
                const transform = this.animationController.getSettleTransform(cssWidth, cssHeight);
                offsetX = transform.offsetX;
                offsetY = transform.offsetY;
                rotation = transform.rotation;
                opacity = transform.opacity;
                darken = transform.darken;
            }
        }

        this.renderer.renderCard(
            passEncoder,
            this.currentTexture,
            offsetX,
            offsetY,
            1.0,
            rotation,
            CONFIG.depthCurrent,
            opacity,
            darken
        );
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
