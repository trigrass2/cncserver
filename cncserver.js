/**
 * @file CNC Server for communicating with hardware via serial commands!
 * Supports EiBotBoart for Eggbot, Ostrich Eggbot and Sylvia's Super-Awesome
 * WaterColorBot
 *
 */

var arguments = process.argv.splice(2);
var port = arguments[0] ? arguments[0] : 4242;
var express = require('express');
var app = express();
var server = require('http').createServer(app);

// Quick change for inverting motors
var invertX = true;
var invertY = false;

// Serial port specific setup
var serialPath = arguments[1] ? arguments[1] : "";
var serialPort = {};
var SerialPort = require("serialport").SerialPort;

// Attempt to auto detect EBB Board via PNPID
if (serialPath == "") {
  console.log('Finding available serial ports...');
} else {
  console.log('Using passed serial port "' + serialPath + '"...');
}

require("serialport").list(function (err, ports) {
  var portNames = ['None'];
  for (var portID in ports){
    portNames[portID] = ports[portID].comName;
    if (ports[portID].pnpId.indexOf('EiBotBoard') !== -1 && serialPath == "") {
      serialPath = portNames[portID];
    }
  }

  console.log('Available Serial ports: ' + portNames.join(', '));

  // Try to connect to serial, or exit with error codes
  if (!serialPath) {
    console.log("EiBotBoard not found. Are you sure it's connected? Exiting with code 22");
    process.exit(22);
  } else {
    console.log('Attempting to open serial port: "' + serialPath + '"...');
    try {
      serialPort = new SerialPort(serialPath, {baudrate : 9600});
    } catch(e) {
      console.log("Serial port failed to connect. Is it busy or in use elsewhere? Exiting with code 10");
      process.exit(10);
    }

    serialPort.on("open", serialPortReadyCallback);
  }
});

// CONFIGURE Data
var colorX = 1620;
config = {
  name: 'WaterColorBot',
  maxArea: {width: 12630, height: 7200}, // Size in steps
  workArea: {top: 0, left: 2450}, // Size in steps
  drawSpeed: 2000, // Drawing (brush down) speed in steps per second
  moveSpeed: 3000, // Moving (brush up) speed in steps per second
  servo: {
    min: 18000, // Brush Lift amount (lower number lifts higher)
    max: 25000,  // Brush fall (servo arm stays clear)
    rate: 0, // Servo rate sent to the EBB
    duration: 200 // Amount of time (in milliseconds) a full movement takes
  },
  tools: {
    water0: {
      x: 0,
      y: 0,
      wiggleAxis: 'y',
      wiggleTravel: 500,
      wiggleIterations: 4
    },
    water1: {
      x: 0,
      y: 2900,
      wiggleAxis: 'y',
      wiggleTravel: 500,
      wiggleIterations: 4
    },
    water2: {
      x: 0,
      y: 5650,
      wiggleAxis: 'y',
      wiggleTravel: 500,
      wiggleIterations: 4
    },
    color0: {
      x: colorX,
      y: 0,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color1: {
      x: colorX,
      y: 1050,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color2: {
      x: colorX,
      y: 2000,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color3: {
      x: colorX,
      y: 2950,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color4: {
      x: colorX,
      y: 3750,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color5: {
      x: colorX,
      y: 4750,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color6: {
      x: colorX,
      y: 5650,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    },
    color7: {
      x: colorX,
      y: 6550,
      wiggleAxis: 'xy',
      wiggleTravel: 500,
      wiggleIterations: 8
    }
  }
};


// STATE Variables
var pen  = {
  x: 0, // Assume we start in top left corner
  y: 0,
  state: 0, // Pen state is from 0 (up/off) to 1 (down/on)
  tool: 0,
  distanceCounter: 0 // Holds a running tally of distance travelled
}


// No events are bound till we have a real serial connection
function serialPortReadyCallback() {
  console.log('Serial connection open at 9600bps');

  // Start express hosting the site from "webroot" folder on the given port
  server.listen(port);
  app.configure(function(){
    app.use("/", express.static(__dirname + '/webroot'));
    app.use(express.bodyParser());
  });
  console.log('CNC server listening on localhost:' + port);

  // Set initial EBB values from Config
  // SERVO
  console.log('Sending EBB config...')
  serialCommand('SC,4,' + config.servo.min);
  serialCommand('SC,5,' + config.servo.max);
  serialCommand('SC,10,' + config.servo.rate);

  // CNC Server API ============================================================
  // Return/Set PEN state  API =================================================
  app.all("/pen", function(req, res){
    res.set('Content-Type', 'application/json; charset=UTF-8');

    if (req.route.method == 'get') {
      // GET pen state
      res.send(JSON.stringify(pen));
    } else if (req.route.method == 'put') {
      // SET/UPDATE pen status
      setPen(req.body, function(stat){
        if (!stat) {
          res.status(500).send(JSON.stringify({
            status: 'Error'
          }));
        } else {
          if (req.body.ignoreTimeout){
            res.status(202).send(JSON.stringify(pen));
          } else {
            res.status(200).send(JSON.stringify(pen));
          }
        }
      });
    } else if (req.route.method == 'delete'){
      // Reset pen to defaults (park)
      console.log('Parking Pen...');
      setPen({state: 0});
      setPen({x: 0, y:0, park: true}, function(stat){
        if (!stat) {
          res.status(500).send(JSON.stringify({
            status: 'Error'
          }));
        } else {
          res.status(200).send(JSON.stringify(pen));
        }
      });
    } else {
      res.status(405).send(JSON.stringify({
        status: 'Not supported'
      }));
    }
  });

  // Return/Set Motor state API ================================================
  app.all("/motors", function(req, res){
    res.set('Content-Type', 'application/json; charset=UTF-8');

    console.log(req.route.method);

    // Disable/unlock motors
    // TODO: Find out why jQuery sends a GET for this...
    if (req.route.method == 'delete' || req.route.method == 'get') {
      console.log('Disabling motors');
      serialCommand('EM,0,0', function(data){
        if (data) {
          res.status(200).send(JSON.stringify({
            status: 'Disabled'
          }));
        } else {
          res.status(500).send(JSON.stringify({
            status: 'Error'
          }));
        }
      });
    } else {
      res.status(405).send(JSON.stringify({
        status: 'Not supported'
      }));
    }
  });

  // Get/Change Tool API ================================================
  app.all("/tools", function(req, res){
    res.set('Content-Type', 'application/json; charset=UTF-8');

    var toolName = req.params.tool;
    if (req.route.method == 'get') { // Get list of tools
      res.status(200).send(JSON.stringify({tools: Object.keys(config.tools)}));
    } else {
      res.status(405).send(JSON.stringify({
        status: 'Not supported'
      }));
    }
  });

  app.all("/tools/:tool", function(req, res){
    res.set('Content-Type', 'application/json; charset=UTF-8');

    var toolName = req.params.tool;
    // TODO: Support other tool methods... (needs API design!)
    if (req.route.method == 'put') { // Set Tool
      if (config.tools[toolName]){
        setTool(toolName, function(data){
          pen.tool = toolName;
          res.status(200).send(JSON.stringify({
            status: 'Tool changed to ' + toolName
          }));
        })
      } else {
        res.status(404).send(JSON.stringify({
          status: 'Tool not found'
        }));
      }
    } else {
      res.status(405).send(JSON.stringify({
        status: 'Not supported'
      }));
    }
  });


  // UTILITY FUNCTIONS =======================================================
  function setPen(inPen, callback) {

    // Counter Reset
    if (inPen.resetCounter) {
      pen.distanceCounter = 0;
      callback(true);
      return;
    }

    // Validate inPen (just force invalid to be valid for now)
    if (inPen.state !== undefined){
      // Future will support non-integers, but for now, 0 or 1
      // TODO: Add support for pen up/down percentage
      inPen.state = Math.abs(parseInt(inPen.state));
      inPen.state = inPen.state > 1 ?  1 : inPen.state;
    } else {
      inPen.state = pen.state;
    }

    // State has changed
    if (inPen.state != pen.state) {
      // Flop state value on write
      serialCommand('SP,' + (pen.state == 1 ? 1 : 0), function(data){
        if (data) {
          pen.state = inPen.state;
        }

        // Pen lift / drop
        if (callback) {
          setTimeout(function(){
            callback(data);
          }, config.servo.duration);
        }
      });

      return;
    }

    // Absolute positions are set
    if (inPen.x !== undefined){
      // Input values are given as percentages of working area (not max area)

      // Sanity check incoming values
      inPen.x  = inPen.x > 100 ? 100 : inPen.x;
      inPen.x  = inPen.x < 0 ? 0 : inPen.x;

      inPen.y  = inPen.y > 100 ? 100 : inPen.y;
      inPen.y  = inPen.y < 0 ? 0 : inPen.y;

      // Convert the percentage values into real absolute and appropriate values
      var absInput = {
        x: config.workArea.left + ((inPen.x / 100) * (config.maxArea.width - config.workArea.left)),
        y: config.workArea.top + ((inPen.y / 100) * (config.maxArea.height - config.workArea.top))
      }

      if (inPen.park) {
        absInput.x-= config.workArea.left;
        absInput.y-= config.workArea.top;

        // Don't repark if already parked
        if (pen.x == 0 && pen.y == 0) {
          callback(false);
          return;
        }
      }

      // Actually move the pen!
      var distance = movePenAbs(absInput, callback, inPen.ignoreTimeout);
      if (pen.state) {
        pen.distanceCounter+= distance;
      }
      return;
    }

    if (callback) callback(true);
  }

  // Tool change
  function setTool(toolName, callback) {
    var tool = config.tools[toolName];

    console.log('Changing to tool: ' + toolName);

    // Pen Up
    setPen({state: 0}, function(){
      // Move to the tool
      movePenAbs(tool, function(data){
        // Pen down
        setPen({state: 1}, function(){
          // Wiggle the brush a bit
          wigglePen(tool.wiggleAxis, tool.wiggleTravel, tool.wiggleIterations, function(){
            callback(data);
          });
        });
      });
    });
  }

  // Move the Pen to an absolute point in the entire work area
  // Returns distance moved, in steps
  function movePenAbs(point, callback, immediate) {
    // Sanity check absolute position input point
    point.x = point.x > config.maxArea.width ? config.maxArea.width : point.x;
    point.x = point.x < 0 ? 0 : point.x;

    point.y = point.y > config.maxArea.height ? height : point.y;
    point.y = point.y < 0 ? 0 : point.y;

    //console.log('Absolute pos: ', point)

    var change = {
      x: Math.round(point.x - pen.x),
      y: Math.round(point.y - pen.y)
    }

    // Don't do anything if there's no change
    if (change.x == 0 && change.y == 0) {
      callback(false);
      return;
    }

    console.log('Pos Change: ', change);

    var distance = Math.sqrt( Math.pow(change.x, 2) + Math.pow(change.y, 2));
    var speed = pen.state ? config.drawSpeed : config.moveSpeed;
    var duration = parseInt(distance / speed * 1000); // How many steps a second?

    //console.log('Distance to move: ' + distance + ' steps');
    //console.log('Time to Take: ' + duration + ' ms');

    pen.x = point.x;
    pen.y = point.y;

    // Invert X or Y to match stepper direction
    change.x = invertX ? change.x * -1 : change.x;
    change.y = invertY ? change.y * -1 : change.y;

    // Send the final serial command
    serialCommand('SM,' + duration + ',' + change.x + ',' + change.y, function(data){
      // Can't trust this to callback when move is done, so trust duration
      if (immediate == 1) {
        callback(data);
      } else {
        setTimeout(function(){
          callback(data);
        }, duration);
      }
    });

    return distance;
  }


  function wigglePen(axis, travel, iterations, callback){
    var start = {x: pen.x, y: pen.y};
    var i = 0;

    // Start the wiggle!
    _wiggleSlave(true);

    function _wiggleSlave(toggle){
      var point = {x: start.x, y: start.y};

      if (axis == 'xy') {
        var rot = i % 4; // Ensure rot is always 0-3

        // This confuluted series ensure the wiggle moves in a proper diamond
        if (rot % 3) { // Results in F, T, T, F
          if (toggle) {
            point.y+= travel/2; // Down
          } else {
            point.x-= travel; // Left
          }
        } else {
           if (toggle) {
             point.y-= travel/2; // Up
           } else {
             point.x+= travel; // Right
           }
        }
      } else {
        point[axis]+= (toggle ? travel : travel * -1);
      }

      movePenAbs(point, function(){
        i++;

        if (i <= iterations){ // Wiggle again!
          _wiggleSlave(!toggle);
        } else { // Done wiggling, go back to start
          movePenAbs(start, callback);
        }
      })
    }
  }

  // BLOCKING SERIAL READ/WRITE ================================================
  function serialCommand(command, callback){
    console.log('Executing serial command: ' + command);
    serialPort.write(command + "\r", function(err, results) {
      // TODO: Better Error Handling
      if (err) {
        // What kind of error is this anyways? :P
        console.log('err ' + err);
        if (callback) callback(false);
      } else {
        // This is terrible, but.. you can NOT trust the data return
        if (callback) callback(true);
      }
    });
  }
};
