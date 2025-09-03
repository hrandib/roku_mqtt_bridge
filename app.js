#!/usr/bin/env node

const express = require('express');
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


function getHostIp() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let hostIp = null;
    // Find a suitable IP address to advertise
    for (const iface in interfaces) {
        for (const details of interfaces[iface]) {
            if (details.family === 'IPv4' && !details.internal) {
                hostIp = details.address;
                console.log(`Using IP address ${hostIp} for SSDP discovery.`);
                break;
            }
        }
        if (hostIp) {
            break;
        }
    }
    
    if (!hostIp) {
        console.error("Could not determine host IP address for SSDP discovery.");
        process.exit(1);
    }
    return hostIp;
}

const hostIp = getHostIp();

const config = ini.parse(fs.readFileSync(configFile, 'utf-8'));
const apps = config.apps.split(' ');
console.log("Defined apps: " + config.apps);

const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://' + config.mqtt_broker);

client.on('connect', () => {
    console.log("MQTT connected");
});

function getAppResponse(apps) {
    let res = '<apps>';
    for (let i = 0; i < apps.length; ++i) {
        res += `<app id="${i}">${apps[i]}</app>`;
    }
    res += `<app id="999">Dummy</app>`;
    res += '</apps>\n';
    return res;
}

app.get('/', (req, res) => {
    res.send('Roku ECP emulation server');
});

app.listen(port, () => {
    console.log(`Roku ECP server listening at http://${hostIp}:${port}`);
});

app.get('/query/apps', (req, res) => {
    res.send(getAppResponse(apps));
});

let appIndex = 0;

app.post('/launch/:id', (req, res, next) => {
    appIndex = +req.params.id;
    console.log('Select app: ' + apps[appIndex]);
    next();
});

app.post('/keypress/:cmd', (req, res) => {
    console.log(`${apps[appIndex]}`, req.params.cmd);
    client.publish(`Roku/${apps[appIndex]}`, req.params.cmd);
    res.sendStatus(200);
});

// Start of SSDP Implementation

const SsdpServer = require('node-ssdp').Server;

const ssdpServer = new SsdpServer({
    location: `http://${hostIp}:${port}/`,
    udn: 'uuid:roku:ecp:my-roku-ecp-emulator', // Unique identifier for the device
    ssdpSig: 'Roku UPnP/1.0 MiniUPnPd/1.4', // Server signature to mimic a Roku device
    st: 'roku:ecp' // The service type Roku remotes will search for
});

ssdpServer.addUSN('upnp:rootdevice');
ssdpServer.addUSN('roku:ecp');

ssdpServer.on('advertise-alive', (headers) => {
    console.log('SSDP advertise-alive', headers.USN);
});

ssdpServer.on('advertise-bye', (headers) => {
    console.log('SSDP advertise-bye', headers.USN);
});

// Start the SSDP server
ssdpServer.start()
    .then(() => {
        console.log('SSDP server started.');
    })
    .catch(err => {
        console.error('Failed to start SSDP server:', err);
    });

process.on('exit', () => {
    ssdpServer.stop(); // Gracefully stop the SSDP server on exit
});