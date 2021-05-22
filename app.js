#!/usr/bin/env node

const express = require('express')
const app = express()
const port = 8060

const fs = require('fs')
  , ini = require('ini')

const systemConfigLocation = '/etc/roku_bridge.conf'
const localConfigLocation = './roku_bridge.conf'
let configFile = localConfigLocation
if(!fs.existsSync(configFile)) {
     configFile = systemConfigLocation
}

if(!fs.existsSync(configFile)) {
    console.error("Config file is not accessible.\nSearch locations: "
      + localConfigLocation + ", " + systemConfigLocation)
    process.exit(1)
}


const config = ini.parse(fs.readFileSync(configFile, 'utf-8'))
const apps = config.apps.split(' ')
console.log("Defined apps: " + config.apps)

const mqtt = require('mqtt')
const client  = mqtt.connect('mqtt://' + config.mqtt_broker)

client.on('connect', () => {
    console.log("MQTT connected")
})

function getAppResponse(apps) {
    res = '<apps>'
    for(i = 0; i < apps.length; ++i) {
        res += `<app id="${i}">${apps[i]}</app>`
    }
    res += `<app id="999">Dummy</app>`
    res += '</apps>\n'
    return res
}

app.get('/', (req, res) => {
    res.send('Roku ECP emulation server')
})

app.listen(port, () => {
    console.log(`Roku ECP server listening at http://localhost:${port}`)
})

app.get('/query/apps', (req, res) => {
    res.send(getAppResponse(apps))
})

let appIndex = 0

app.post('/launch/:id', (req, res, next) =>  {
    appIndex = +req.params.id
    console.log('Select app: ' + apps[appIndex])
    next()
})

app.post('/keypress/:cmd', (req, res) => {
    console.log(`${apps[appIndex]}`, req.params.cmd)
    client.publish(`Roku/${apps[appIndex]}`, req.params.cmd)
})
