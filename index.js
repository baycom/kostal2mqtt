var util=require('util');
var mqtt=require('mqtt');
var ModbusRTU = require("modbus-serial");
var Parser = require('binary-parser').Parser;
const commandLineArgs = require('command-line-args')
var errorCounter = 0;

const optionDefinitions = [
	{ name: 'mqtthost', alias: 'm', type: String, defaultValue: "localhost" },
	{ name: 'mqttclientid', alias: 'c', type: String, defaultValue: "kostal1Client" },
	{ name: 'inverterhost', alias: 'i', type: String, defaultValue: "10.0.0.21"},
	{ name: 'inverterport', alias: 'p', type: String, defaultValue: "1502"},
        { name: 'address',      alias: 'a', type: Number, multiple:true, defaultValue: [71] },
        { name: 'wait',         alias: 'w', type: Number, defaultValue: 10000 },
        { name: 'debug',        alias: 'd', type: Boolean, defaultValue: false },
  ];

const options = commandLineArgs(optionDefinitions)

var KostalSerialNumber=[];
var modbusClient = new ModbusRTU();

modbusClient.setTimeout(1000);

if(options.inverterhost) {
	modbusClient.connectTcpRTUBuffered(options.inverterhost, { port: parseInt(options.inverterport),  debug: true }).catch((error) => {
		console.error(error);
		process.exit(-1);
	});
} else if(options.inverterport) {
	modbusClient.connectRTUBuffered(options.inverterport, { baudRate: 9600, parity: 'none' }).catch((error) => {
		console.error(error);
		process.exit(-1);
	});
}

console.log("MQTT Host         : " + options.mqtthost);
console.log("MQTT Client ID    : " + options.mqttclientid);
console.log("Kostal MODBUS addr: " + options.address);

if(options.inverterhost) {
	console.log("Kostal host       : " + options.inverterhost + ":" + options.inverterport);
} else {
	console.log("Kostal serial port: " + options.inverterport);
}

var MQTTclient = mqtt.connect("mqtt://"+options.mqtthost,{clientId: options.mqttclientid});
	MQTTclient.on("connect",function(){
	console.log("MQTT connected");
})

MQTTclient.on("error",function(error){
		console.log("Can't connect" + error);
		process.exit(1)
	});

function sendMqtt(id, data) {
        if(options.debug) {
	        console.log("publish: "+'Kostal/' + id, JSON.stringify(data));
	}
        MQTTclient.publish('Kostal/' + id, JSON.stringify(data));        
}

const PIKOPayloadParser_56 = new Parser()
	.uint16be('InverterState') //56
	.seek(2)
	;

const PIKOPayloadParser_98 = new Parser()
	.floatbe('Temperature') //98
	;

const PIKOPayloadParser_150 = new Parser()
	.floatbe('ActualCosPhi') //150
	.floatbe('GridFrequency') //152
	.floatbe('CurrentL1') //154
	.floatbe('ActivePowerL1') //156
	.floatbe('VoltageL1') //158
	.floatbe('CurrentL2') //160
	.floatbe('ActivePowerL2') //162
	.floatbe('VoltageL2') //164
	.floatbe('CurrentL3') //166
	.floatbe('ActivePowerL3') //168
	.floatbe('VoltageL3') //170
	.floatbe('TotalActivePower') //172
	.floatbe('TotalReactivePower') //174
	.seek((178-176)*2)
	.floatbe('TotalApparentPower') //178
	;

const PIKOPayloadParser_258 = new Parser()
	.floatbe('CurrentDC1') //258
	.floatbe('PowerDC1') //260
	.seek((266-262)*2)
	.floatbe('VoltageDC1') //266
	.floatbe('CurrentDC2') //268
	.floatbe('PowerDC2') //270
	.seek((276-272)*2)
	.floatbe('VoltageDC2') //276
	.floatbe('CurrentDC3') //278
	.floatbe('PowerDC3') //280
	.seek((286-282)*2)
	.floatbe('VoltageDC3') //286
	;

const PIKOPayloadParser_320 = new Parser()
	.floatbe('TotalYield') //320
	.floatbe('DailyYield') //322
	.floatbe('YearlyYield') //324
	.floatbe('MonthlyYield') //326
	;
	
const getPIKOSN = async (address) => {
	try {
		modbusClient.setID(address);
		let vals = await modbusClient.readHoldingRegisters(14, 8);
		KostalSerialNumber[address] = new String(vals.buffer).replace(/\0/g, '');
		if(options.debug) {
			console.log("[" + KostalSerialNumber[address] + "]");
		}
		errorCounter = 0;
	} catch (e) {
		if(options.debug) {
			console.log(e);
		}
		errorCounter++;
		return null;
	}
}

const getPIKORegisters = async (address) => {
	try {
		modbusClient.setID(address);
                let data = await modbusClient.readHoldingRegisters(56, 2);
                let vals_56 = PIKOPayloadParser_56.parse(data.buffer);
                
                data = await modbusClient.readHoldingRegisters(98, 2);
                let vals_98 = PIKOPayloadParser_98.parse(data.buffer);

                data = await modbusClient.readHoldingRegisters(150, 30);
                let vals_150 = PIKOPayloadParser_150.parse(data.buffer);
                
                data = await modbusClient.readHoldingRegisters(258, 30);
                let vals_258 = PIKOPayloadParser_258.parse(data.buffer);

                data = await modbusClient.readHoldingRegisters(320, 8);
                let vals_320 = PIKOPayloadParser_320.parse(data.buffer);
                
                let state =  Object.assign({}, vals_56, vals_98, vals_150, vals_258, vals_320);

		if(options.debug) {
			console.log(util.inspect(state));
		}
		sendMqtt(KostalSerialNumber[address], state);
		errorCounter = 0;
	} catch (e) {
		if(options.debug) {
			console.log(e);
		}
		errorCounter++;
		return null;
	}
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getMetersValue = async (meters) => {
    try{
        var pos=0;
        // get value of all meters
        for(let meter of meters) {
                if(options.debug) {
                        console.log("query: " + meter);
                }
                if(!KostalSerialNumber[meter]) {
			await getPIKOSN(meter);
                }
                await sleep(100);
                if(KostalSerialNumber[meter]) {
			await getPIKORegisters(meter);
		}
		pos++;
        }
        if(errorCounter>30) {
        	console.log("too many errors - exiting");
        	process.exit(-1);
        }
	await sleep(options.wait);
    } catch(e){
        // if error, handle them here (it should not)
        console.log(e)
    } finally {
        // after get all data from salve repeate it again
        setImmediate(() => {
            getMetersValue(meters);
        })
    }
}

// start get value
getMetersValue(options.address);

