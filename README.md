# MTGA Card Study

An interactive WebGPU-powered card study application for Magic: The Gathering Arena avatar cards.

**Live Demo**: This site is automatically deployed to GitHub Pages at `https://YOUR-USERNAME.github.io/mtga-study/`

## Features

- **WebGPU Rendering**: Hardware-accelerated graphics for smooth card animations
- **Physical Card Size**: Cards displayed at 63x88mm based on screen DPI
- **Random Shuffle**: Cards presented in random order, saved via cookies
- **Throw Animation**: Cards fly off screen with rotation when clicked/tapped
- **Card Stack Effect**: Multiple cards visible behind the current card
- **Progressive Visibility**: Card stack becomes less visible as you approach the end
- **Auto-Reshuffle**: When all cards are viewed, automatically reshuffles and starts over
- **Touch Support**: Works on both desktop (click) and mobile (touch) devices

## Requirements

- Modern browser with WebGPU support:
  - Chrome/Edge 113+
  - Other WebGPU-capable browsers

## GitHub Pages Deployment

This repository is configured for automatic deployment to GitHub Pages:

1. **Enable GitHub Pages**:
   - Go to your repository Settings → Pages
   - Under "Source", select "GitHub Actions"

2. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit with WebGPU card study app"
   git push origin main
   ```

3. **Automatic Deployment**:
   - The GitHub Actions workflow will automatically run
   - It generates `cards.json` and deploys the site
   - Your site will be live at `https://YOUR-USERNAME.github.io/mtga-study/`

## Local Development

1. Ensure you have Node.js installed (for generating the card list)
2. Generate the card list:
   ```bash
   node generate-cards-json.js
   ```
3. Serve the website using a local web server (required for loading images):
   ```bash
   # Using Python 3
   python -m http.server 8000

   # Or using Node.js http-server
   npx http-server
   ```
4. Open your browser to `http://localhost:8000`

## Usage

- Click or tap the card to throw it away and reveal the next card
- Cards are shown in a random sequence that persists across sessions
- When all 693 cards have been viewed, the deck automatically reshuffles
- Progress is saved in browser cookies

## How It Works

### Card Display
- Cards are rendered using WebGPU shaders for maximum performance
- The current card is displayed at the front
- Up to 5 cards are visible in the background stack
- Cards are automatically sized to 63x88mm based on your screen's DPI

### Animation
- When you click/tap, the current card is thrown in a random direction
- The card rotates as it flies off screen
- Animation uses cubic easing for natural motion

### Progress Tracking
- Your position in the deck is saved in a browser cookie
- The shuffle order is also saved, so you'll always continue where you left off
- Clearing your cookies will reset your progress

## File Structure

- `index.html` - Main HTML structure
- `app.js` - WebGPU application and card logic
- `cards.json` - List of all card image paths (generated)
- `avatar_cards/` - Directory containing all card images
- `generate-cards-json.js` - Script to generate cards.json

## Technical Details

- **Graphics API**: WebGPU
- **Card Dimensions**: 63mm × 88mm (standard TCG card size)
- **Total Cards**: 693 avatar cards
- **Image Format**: WebP
- **Animation Duration**: 500ms per card throw
