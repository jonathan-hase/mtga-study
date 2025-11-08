const fs = require('fs');
const path = require('path');

const avatarCardsDir = path.join(__dirname, 'avatar_cards');
const outputFile = path.join(__dirname, 'cards.json');

try {
    const files = fs.readdirSync(avatarCardsDir)
        .filter(file => file.endsWith('.webp'))
        .map(file => `avatar_cards/${file}`);

    fs.writeFileSync(outputFile, JSON.stringify(files, null, 2));
    console.log(`Generated cards.json with ${files.length} cards`);
} catch (error) {
    console.error('Error generating cards.json:', error);
    process.exit(1);
}
