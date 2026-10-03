import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from './models/User.js';

dotenv.config();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));

// Create a route for the app specifically, though it's served statically
app.get('/app', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'app.html'));
});

app.get('/app-offline', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'app-offline.html'));
});

// Since we have the index.html from MostTranslate at the root, we'll serve it
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Auth Pages
app.get('/login', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'profile.html'));
});

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/accessible-world';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Auth API Routes
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        const user = new User({ name, email, password });
        await user.save();
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '7d' });
        res.status(201).json({ token, user: { id: user._id, name, email } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error registering user' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, name: user.name, email } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error logging in' });
    }
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

wss.on('connection', (ws) => {
    console.log('[Server] Client connected to WebSocket');
    let geminiWs;

    if (!GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not set in .env');
        ws.send(JSON.stringify({ 
            error: 'Server missing GEMINI_API_KEY. Please set it in the .env file.' 
        }));
        ws.close();
        return;
    }

    // Connect to Gemini 2.0 Multimodal Live API
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
    
    geminiWs = new WebSocket(url);

    geminiWs.on('open', () => {
        console.log('[Server] Connected to Gemini Live API');
        
        // 1. Setup Handshake & Guardrails
        const setupPayload = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                systemInstruction: {
                    parts: [{
                        text: "You are an Accessible World Translator. You must strictly use clock-face directions (e.g., '12 o'clock'). Do NOT guess obscured traffic lights or signs under any circumstances."
                    }]
                },
                generationConfig: {
                    // 2. Native Audio Processing: Return Audio directly
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Aoede"
                            }
                        }
                    }
                }
            }
        };
        geminiWs.send(JSON.stringify(setupPayload));
    });

    geminiWs.on('message', (data) => {
        // Relay messages from Gemini down to the web client
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data.toString());
        }
    });

    geminiWs.on('close', () => {
        console.log('[Server] Gemini connection closed');
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });

    geminiWs.on('error', (err) => {
        console.error('[Server] Gemini WS Error:', err);
    });

    ws.on('message', (message) => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            // Relay client messages (audio/video chunks) up to Gemini
            geminiWs.send(message.toString());
        }
    });

    ws.on('close', () => {
        console.log('[Server] Client disconnected');
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
