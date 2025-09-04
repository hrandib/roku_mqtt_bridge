#!/usr/bin/env node

const express = require('express');
const morgan = require('morgan');
const app = express();
const port = 8060;

const fs = require('fs');
const ini = require('ini');

const systemConfigLocation = '/etc/roku_bridge.conf';
const localConfigLocation = './roku_bridge.conf';
let configFile = localConfigLocation;
if (!fs.existsSync(configFile)) {
    configFile = systemConfigLocation;
}

if (!fs.existsSync(configFile)) {
    console.error("Config file is not accessible.\nSearch locations: " +
        localConfigLocation + ", " + systemConfigLocation);
    process.exit(1);
}

const deviceInfo = {
    udn: 'uuid:roku:ecp:my-roku-ecp-emulator',
    serialNumber: 'ROKU_BRIDGE_EMULATOR',
    deviceId: 'EMULATOR12345',
    modelName: 'Roku Bridge',
    powerMode: 'PowerOn',
    networkType: 'ethernet',
    macAddress: 'DE:AD:BE:EF:CA:FE' // Example MAC
};

const config = ini.parse(fs.readFileSync(configFile, 'utf-8'));
const apps = config.apps.split(' ');
console.log("Defined apps: " + config.apps);

const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://' + config.mqtt_broker);

client.on('connect', () => {
    console.log("MQTT connected");
});

function getAppResponse(apps) {
    let res = `<apps>
        <app id="12" type="appl" version="5.0.98079430">Netflix</app>
        <app id="13" type="appl" version="12.3.2021122417">Prime Video</app>
        <app id="837" type="appl" version="2.22.105005058">YouTube</app> 
    </apps>`;
    console.log("Generated app response: " + res);
    return res;
}

function getHomePageHtml(deviceInfo, apps) {
    const remoteButtons = [
        ['Home'],
        ['Rev', 'Fwd'],
        ['Up'],
        ['Left', 'Select', 'Right'],
        ['Down'],
        ['Back', 'InstantReplay', 'Info'],
        ['Play']
    ];

    let buttonsHtml = remoteButtons.map(row =>
        `<div class="button-row">` +
        row.map(button => `<button onclick="keypress('${button}')">${button.replace(/([A-Z])/g, ' $1').trim()}</button>`).join('') +
        `</div>`
    ).join('');

    let appsHtml = apps.map((app, i) => `<li>${app} (id: ${i})</li>`).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Roku ECP Emulator</title>
            <style>
                body { font-family: sans-serif; background: #222; color: #eee; }
                .container { max-width: 800px; margin: auto; padding: 20px; }
                h1, h2 { color: #aaa; border-bottom: 1px solid #444; padding-bottom: 5px; }
                table { border-collapse: collapse; width: 100%; }
                td, th { text-align: left; padding: 8px; border-bottom: 1px solid #333; }
                .remote { text-align: center; margin-top: 20px; }
                .button-row { display: flex; justify-content: center; margin-bottom: 10px; }
                button { background: #444; color: white; border: 1px solid #666; padding: 15px; margin: 0 5px; border-radius: 5px; min-width: 100px; cursor: pointer; }
                button:hover { background: #555; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Roku ECP Emulator</h1>
                <h2>Device Information</h2>
                <table>
                    <tr><td>Model</td><td>${deviceInfo.modelName}</td></tr>
                    <tr><td>Serial Number</td><td>${deviceInfo.serialNumber}</td></tr>
                    <tr><td>Device ID</td><td>${deviceInfo.deviceId}</td></tr>
                    <tr><td>MAC Address</td><td>${deviceInfo.macAddress}</td></tr>
                </table>

                <h2>Installed Applications</h2>
                <ul>${appsHtml}</ul>

                <h2>Remote Control</h2>
                <div class="remote">${buttonsHtml}</div>
            </div>
            <script>
                function keypress(cmd) {
                    fetch('/keypress/' + cmd, { method: 'POST' })
                        .then(res => console.log('Sent command: ' + cmd + ', Status: ' + res.status));
                }
            </script>
        </body>
        </html>
    `;
}


// --- Basic Server Setup ---
app.listen(port, () => {
    console.log(`Roku ECP server listening at http://localhost:${port}`);
});

// --- State Management ---
let appIndex = 0;

// =================================================================
// --- ECP Command Handlers ---
// =================================================================

// --- Root Endpoint ---
app.get('/', (req, res) => {
    console.log("Received request for /");
    res.send(getHomePageHtml(deviceInfo, apps));
});

// --- Query Endpoints ---

// Returns a list of available applications
app.get('/query/apps', (req, res) => {
    console.log("Received request for /query/apps");
    res.set('Content-Type', 'text/xml');
    res.send(getAppResponse(apps));
});

// Returns the currently active application
app.get('/query/active-app', (req, res) => {
    console.log("Received request for /query/active-app");
    const activeApp = apps[appIndex] || 'None';
    res.set('Content-Type', 'text/xml');
    res.send(`<active-app><app id="${appIndex}">${activeApp}</app></active-app>`);
});

// Returns detailed information about the emulated device
app.get('/query/device-info', (req, res) => {
    console.log("Received request for /query/device-info");
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8" ?>
        <device-info>
            <udn>${deviceInfo.udn}</udn>
            <serial-number>${deviceInfo.serialNumber}</serial-number>
            <device-id>${deviceInfo.deviceId}</device-id>
            <model-name>${deviceInfo.modelName}</model-name>
            <power-mode>${deviceInfo.powerMode}</power-mode>
            <network-type>${deviceInfo.networkType}</network-type>
            <mac-address>${deviceInfo.macAddress}</mac-address>
        </device-info>
    `);
});

// Returns the icon for a specific application
app.get('/query/icon/:appId', (req, res) => {
    const appId = req.params.appId;
    console.log(`Received request for /query/icon/${appId}`);
    // This would typically serve an actual image file.
    // For now, we'll send a 404 Not Found as we don't have icons.
    res.status(404).send('Not Found');
});


// --- Keypress and Launch Endpoints ---

// Handles keypress commands
app.post('/keypress/:cmd', (req, res) => {
    const cmd = req.params.cmd;
    console.log(`Received keypress: '${cmd}' for app: '${apps[appIndex]}'`);
    client.publish(`Roku/${apps[appIndex]}`, cmd);
    res.sendStatus(200);
});

// Handles keydown commands (part of a press-and-hold sequence)
app.post('/keydown/:cmd', (req, res) => {
    const cmd = req.params.cmd;
    console.log(`Received keydown: '${cmd}' for app: '${apps[appIndex]}'`);
    // MQTT publish could be added here if needed
    res.sendStatus(200);
});

// Handles keyup commands (part of a press-and-hold sequence)
app.post('/keyup/:cmd', (req, res) => {
    const cmd = req.params.cmd;
    console.log(`Received keyup: '${cmd}' for app: '${apps[appIndex]}'`);
    // MQTT publish could be added here if needed
    res.sendStatus(200);
});

// Launches an application by its ID
app.post('/launch/:appId', (req, res) => {
    const id = parseInt(req.params.appId, 10);
    console.log(`Received launch request for app ID: ${id}`);

    appIndex = id;
    console.log(`Successfully launched app: ${apps[appIndex]}`);
    res.sendStatus(200);
});


// --- Input Endpoint (for text entry) ---
app.post('/input', (req, res) => {
    // This endpoint receives form data
    console.log("Received request for /input with params:", req.query);
    res.sendStatus(200);
});


// --- Search Endpoint ---
app.post('/search', (req, res) => {
    const keyword = req.query.keyword;
    console.log(`Received request for /search with keyword: '${keyword}'`);
    res.sendStatus(200);
});

// 404 Handler (for unhandled routes)
app.use((req, res, next) => {
    const error = new Error('Not Found');
    error.status = 404;
    next(error);
});

// General Error Handler (logs and responds to all errors)
app.use((error, req, res, next) => {
    console.error(`Unhandled request: ${req.method} ${req.originalUrl}`);
    console.error(`Error status: ${error.status || 500}`);
    console.error(`Error message: ${error.message}`);

    res.status(error.status || 500);
    res.json({
        error: {
            message: error.message || 'Internal Server Error'
        }
    });
});

// =================================================================
// --- SSDP Discovery Implementation ---
// =================================================================
const SsdpServer = require('node-ssdp').Server;
const os = require('os');

const interfaces = os.networkInterfaces();
let hostIp = '';

for (const iface in interfaces) {
    for (const details of interfaces[iface]) {
        if (details.family === 'IPv4' && !details.internal) {
            hostIp = details.address;
            break;
        }
    }
    if (hostIp) break;
}

if (!hostIp) {
    console.error("Could not determine host IP address for SSDP discovery.");
    process.exit(1);
}

const ssdpServer = new SsdpServer({
    location: `http://${hostIp}:${port}/`,
    udn: 'uuid:roku:ecp:my-roku-ecp-emulator',
    ssdpSig: 'Roku UPnP/1.0 MiniUPnPd/1.4',
    st: 'roku:ecp'
});

ssdpServer.addUSN('upnp:rootdevice');
ssdpServer.addUSN('roku:ecp');

ssdpServer.on('advertise-alive', (headers) => {
    // console.log('SSDP advertise-alive', headers.USN); // Can be noisy
});

ssdpServer.on('advertise-bye', (headers) => {
    // console.log('SSDP advertise-bye', headers.USN);
});

ssdpServer.start()
    .then(() => {
        console.log('SSDP server started successfully.');
    })
    .catch(err => {
        console.error('Failed to start SSDP server:', err);
    });

process.on('exit', () => {
    ssdpServer.stop();
});