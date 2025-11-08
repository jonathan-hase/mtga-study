# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive WebGPU-powered card study application for Magic: The Gathering Arena avatar cards. Users can study 693 cards by clicking/tapping through them in a randomized order with animated card throws.

## Repository Structure

- `index.html` - Main HTML page with canvas element
- `app.js` - WebGPU application (CardStudyApp class)
- `cards.json` - Auto-generated list of card image paths (693 cards)
- `avatar_cards/` - Card images in WebP format (de_*.webp)
- `generate-cards-json.js` - Utility to regenerate cards.json
- `README.md` - User-facing documentation

## Common Commands

```bash
# Generate/regenerate the card list JSON
node generate-cards-json.js

# Run local development server (required for loading images)
python -m http.server 8000
# or
npx http-server
```

## Architecture

### WebGPU Rendering Pipeline
- **CardStudyApp** - Main application class managing state, rendering, and interactions
- **Shader System** - Vertex/fragment shaders for rendering card quads with textures
- **Texture Cache** - Caches loaded card textures to avoid reloading
- **Transform System** - Matrix-based transformations for card positioning, rotation, scaling

### Key Features
1. **Physical Card Sizing**: Calculates 63x88mm card display size based on screen DPI (96 DPI = 25.4mm/inch)
2. **Depth Layering**: Renders up to 5 cards behind the current card using depth values
3. **Progressive Visibility**: Stack visibility decreases as fewer cards remain
4. **Cookie Persistence**: Saves shuffle order and current position in browser cookies
5. **Throw Animation**: 500ms cubic-eased animation with random direction and rotation

### State Management
- `shuffledIndices` - Array of card indices in random order (Fisher-Yates shuffle)
- `currentCardIndex` - Current position in shuffled deck
- `currentTexture` - GPU texture for active card
- `nextTextures` - Preloaded textures for stack (up to 5 cards)
- Cookie format: `{indices: number[], current: number}`

### Animation System
- Uses `requestAnimationFrame` for smooth 60fps rendering
- Throw animation: random angle (0-360°), distance (2.5-3.0x), rotation (-360 to +360°)
- Easing function: `1 - (1 - t)³` (ease-out cubic)

## Development Notes

- WebGPU requires HTTPS or localhost
- Cards must be served via HTTP server (no file:// protocol)
- Browser compatibility: Chrome/Edge 113+, other WebGPU-capable browsers
- Total asset size: ~52MB (693 WebP images)

## Modifying the Application

- To change card size: Modify `cardWidthMM` and `cardHeightMM` in CardStudyApp constructor
- To adjust stack depth: Change `maxStack` constant in render() method
- To modify animation: Adjust `duration` in animateThrow() and easing function
- To change throw physics: Modify `distance` and `throwRotation` calculations in throwCard()
