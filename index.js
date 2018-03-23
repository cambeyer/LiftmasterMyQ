var express = require('express');
var app = express();
var busboy = require('connect-busboy');
var path = require('path');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var dateTime = require('date-time');

var request = require('request');

var OPEN_COMMAND = "open";
var CLOSE_COMMAND = "close";
var LIST_COMMAND = "list";

var SET_COOKIE_RESPONSE = "set-cookie";
var SESSION_ID_FIELD = "ASP.NET_SessionId";
var FORM_DATA_TYPE = "application/x-www-form-urlencoded";
var APPLICATION_COOKIE_FIELD = ".AspNet.ApplicationCookie";
var EXTRA_SPECIAL_FIELD = "TS019de027_30";
var ACCOUNT_ID_FIELD = "acctID";
var BRAND_NAME = "Liftmaster";
var DEVICE_TYPE_ID_FIELD = "DeviceTypeId";
var GARAGE_DOOR_TYPE = 2;
var OPEN_CLOSED_INDICATOR_FIELD = "ToggleAttributeValue";
var DEVICE_ID_FIELD = "MyQDeviceId";

var URL_TO_GET_SESSION = "https://www.myliftmaster.com/Dashboard";
var URL_TO_LOGIN = "https://www.myliftmaster.com/";
var EMAIL_FIELD = "Email";
var PASSWORD_FIELD = "Password";
var URL_TO_GET_ACCOUNT_NUMBER = "https://www.myliftmaster.com/Dashboard";
var URL_TO_GET_DEVICES = "https://www.myliftmaster.com/api/MyQDevices/GetAllDevices";
var URL_TO_TOGGLE_DOOR = "https://www.myliftmaster.com/Device/TriggerStateChange";

app.use(busboy());
app.use(express.static(path.join(__dirname, 'public')));

var sendResponse = function(params, message, error) {
    console.log(message);
    if (error) {
        message = "ERROR: " + message;
    }
    if (params.res)
    {
        params.res.send(message);
    }
    if (params.socket)
    {
        params.socket.emit('message', { message: message });
    }
};

var getCookieValue = function(response, field) {
    var cookies = response.headers[SET_COOKIE_RESPONSE].join(", ");
    //console.log("Cookies: " + cookies);
    var fieldindex = cookies.indexOf(field);
    if (fieldindex < 0)
    {
        return "";
    }
    return cookies.substring(fieldindex, cookies.indexOf(";", fieldindex));
};
    
var getSession = function(sequence, params) {
    console.log("Getting Session ID");
    request({
        method: "GET",
        url: URL_TO_GET_SESSION
    }, function (error, response) {
		if (!error && response.statusCode == 200) {
		    var sessionID = getCookieValue(response, SESSION_ID_FIELD);
		    if (sessionID != "") {
    		    console.log("Session ID acquired: " + sessionID);
    		    params.cookie = sessionID;
    		    runSequence(sequence)(sequence, params);
    		    return;
		    }
		}
        sendResponse(params, "Could not fetch session ID", true);
    });
};

var doLogin = function(sequence, params) {
    console.log("Logging in");
    var payload = EMAIL_FIELD + "=" + params.username + "&" + PASSWORD_FIELD + "=" + params.password;
	request({
        method: "POST",
        url: URL_TO_LOGIN,
        headers: {
            'Cookie': params.cookie,
            'Content-Type': FORM_DATA_TYPE
        },
        body: payload
    }, function (error, response) {
		if (!error) {
            var appCookie = getCookieValue(response, APPLICATION_COOKIE_FIELD);
            var special = getCookieValue(response, EXTRA_SPECIAL_FIELD);
            if (appCookie != "" && special != "") {
                console.log("Logged in");
                //console.log(appCookie);
                //console.log(special);
                params.cookie = params.cookie + "; " + appCookie + "; " + special;
                runSequence(sequence)(sequence, params);
                return;
            }
		}
        sendResponse(params, "Login unsuccessful", true);
    });
};

var getAccount = function(sequence, params) {
    console.log("Getting Account Number");
	request({
        method: "GET",
        url: URL_TO_GET_ACCOUNT_NUMBER,
        headers: {
            'Cookie': params.cookie
        }
    }, function (error, response) {
		if (!error && response.statusCode == 200) {
            var account = getCookieValue(response, ACCOUNT_ID_FIELD);
            if (account != "") {
                console.log("Account Number acquired: " + account);
                params.cookie = params.cookie + "; " + account;
                runSequence(sequence)(sequence, params);
                return;
            }
		}
		console.log(response.headers);
		sendResponse(params, "Could not fetch account number", true);
    });
};

var getDevices = function(sequence, params) {
    console.log("Getting Devices");
	request({
        method: "GET",
        url: URL_TO_GET_DEVICES,
        headers: {
            'Cookie': params.cookie
        },
        qs: {
            'brandName': BRAND_NAME
        }
    }, function (error, response, body) {
		if (!error && response.statusCode == 200) {
		    var devices = [];
		    try {
		        devices = JSON.parse(body);
		    } catch (e) {
		        console.log("Could not parse devices response");
		    }
		    if (devices.length > 0) {
		        console.log("Got devices");
		    }
		    for (let device of devices) {
		        if (device[DEVICE_TYPE_ID_FIELD] == GARAGE_DOOR_TYPE) {
		            var serial = device[DEVICE_ID_FIELD];
		            var closed = device[OPEN_CLOSED_INDICATOR_FIELD] == "1";
		            console.log("Found device with serial: " + serial + " which is " + (closed ? "closed" : "open"));
	                params.serial = serial;
	                params.closed = closed;
	                runSequence(sequence)(sequence, params);
	                return;
		        }
		    }
		}
		sendResponse(params, "Could not fetch any MyQ devices", true);
    });
};

var toggleDoor = function(sequence, params) {
    if ((params.command == CLOSE_COMMAND) != params.closed) {
        console.log((params.closed ? "Opening" : "Closing") + " door with serial " + params.serial);
    	request({
            method: "POST",
            url: URL_TO_TOGGLE_DOOR,
            headers: {
                'Cookie': params.cookie,
                'Connection': 'keep-alive'
            },
            qs: {
                'SerialNumber': params.serial,
                'attributename': 'desireddoorstate',
                'attributevalue': (params.closed ? 1 : 0)
            }
        }, function (error, response) {
    		if (!error && response.statusCode == 200) {
    		    sendResponse(params, { serial: params.serial, closed: !params.closed });
    		    runSequence(sequence)();
    		    return;
    		}
    		sendResponse(params, "Could not toggle the door", true);
        });
    } else {
        sendResponse(params, { serial: params.serial, closed: params.closed });
        runSequence(sequence)();
    }
};

var runSequence = function(sequence) {
    if (sequence.length > 0) {
        return sequence.shift();
    } else {
        return function() {
            console.log("Sequence complete");
        };
    }
};

var sendDevices = function(sequence, params) {
    sendResponse(params, { serial: params.serial, closed: params.closed });
    runSequence(sequence)(sequence, params);
};

app.get('/:username/:password/:command', function (req, res){
    var command = req.params.command;
    if (command != OPEN_COMMAND && command != CLOSE_COMMAND && command != LIST_COMMAND) { return; }
    console.log(dateTime({showMilliseconds: true}));
    console.log("Received command: " + command);
    var sequence = [getSession, doLogin, getAccount, getDevices, toggleDoor];
    console.log(req.params.username + " " + req.params.password);
    var params = {
        res: res,
        username: encodeURIComponent(req.params.username),
        password: encodeURIComponent(req.params.password),
        command: command
    };
    if (req.params.command == LIST_COMMAND) {
        sequence = [getSession, doLogin, getAccount, getDevices, sendDevices];
    }
    runSequence(sequence)(sequence, params);
});

var kickoffToggle = function(socket, msg, command) {
    console.log(dateTime({showMilliseconds: true}));
    var sequence = [getSession, doLogin, getAccount, getDevices, toggleDoor];
    var params = {
        socket: socket,
        username: encodeURIComponent(msg.username),
        password: encodeURIComponent(msg.password),
        command: command ? OPEN_COMMAND : CLOSE_COMMAND
    };
    runSequence(sequence)(sequence, params);
};

//when a new client connects
io.on('connection', function(socket) {
	socket.on('login', function(msg) {
	    console.log(dateTime({showMilliseconds: true}));
    	var sequence = [getSession, doLogin, getAccount, getDevices, sendDevices];
        var params = {
            socket: socket,
            username: encodeURIComponent(msg.username),
            password: encodeURIComponent(msg.password)
        };
        runSequence(sequence)(sequence, params);
	});
	
	socket.on('open', function(msg) {
        kickoffToggle(socket, msg, true);
	});
	
    socket.on('close', function(msg) {
    	kickoffToggle(socket, msg, false);
	});
});

http.listen(process.env.PORT, "0.0.0.0", function () {
	console.log('listening on *:' + process.env.PORT);
});