import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function run() {
    for (const version of ['v1alpha', 'v1beta', 'v1']) {
        console.log(`\n--- Fetching models for ${version} ---`);
        const res = await fetch(`https://generativelanguage.googleapis.com/${version}/models?key=${GEMINI_API_KEY}`);
        const data = await res.json();
        if (data.models) {
            const bidiModels = data.models.filter(m => m.supportedGenerationMethods.includes('bidiGenerateContent'));
            if (bidiModels.length > 0) {
                bidiModels.forEach(m => console.log(m.name, "supports BIDI!"));
            } else {
                console.log(`No models support bidiGenerateContent in ${version}.`);
            }
        }
    }
}
run();
