import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const modelsToTest = [
    "models/gemini-2.0-flash-exp"
];

async function testModel(modelName) {
    for (const version of ['v1alpha', 'v1beta']) {
        console.log(`Testing ${modelName} on ${version}...`);
        const success = await new Promise((resolve) => {
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
            const ws = new WebSocket(url);
            
            ws.on('open', () => {
                const setupPayload = {
                    setup: {
                        model: modelName
                    }
                };
                ws.send(JSON.stringify(setupPayload));
            });

            ws.on('message', (data) => {
                console.log(`[${version}] SUCCESS Message:`, data.toString());
                ws.close();
                resolve(true);
            });

            ws.on('close', (code, reason) => {
                console.log(`[${version}] Disconnected. Code: ${code}, Reason: ${reason}`);
                resolve(false);
            });

            ws.on('error', (err) => {
                console.error(`[${version}] Error:`, err.message);
                resolve(false);
            });
        });
        if (success) return true;
    }
    return false;
}

async function runTests() {
    for (const m of modelsToTest) {
        const success = await testModel(m);
        if (success) {
            console.log(`\n=> FOUND WORKING MODEL: ${m}`);
            process.exit(0);
        }
    }
    console.log("None worked.");
    process.exit(1);
}
runTests();
