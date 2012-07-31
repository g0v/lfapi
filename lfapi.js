#!/usr/bin/env node

var main = require('./lfapi/main.js');

var config = main.config;
var db = main.db;

//var config = require('./config.js');

var http = require('http');
var url = require('url');
var qs = require('querystring');

// Add includes method to Arrays
Array.prototype.includes = function (val) {
  for (var i=0; i < this.length; i++) if (this[i] === val) return true;
  return false;
};

// Member sessions, stored value is member_id
var sessions = { };

// create http server
var server = http.createServer(function (req, res, params) {
  req.setEncoding('utf8');
  
  // parse get params
  var url_info = url.parse(req.url, true);
  var params = url_info.query;
  req.params = params;

  req.current_access_level = config.public_access_level;
  req.current_member_id;

  req.sessions = sessions;
  
  // session handling
  if (params.session_key) {
    if (sessions[params.session_key]) {
      req.current_member_id = sessions[params.session_key];
      req.current_access_level = 'member'
    } else {
      main.respond('json', null, req, res, 'forbidden', 'Invalid session key');
    }
  }
  
  // pick cookies from http headers
  var cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(function (cookie) {
      var parts = cookie.split('=');
      cookies[parts[0].trim()] = (parts[1] || '' ).trim();
    });
  };
  
  console.log(req.socket._idleStart, req.socket.remoteAddress, req.current_member_id, req.current_access_level, req.method, url_info.pathname, url_info.query);

  var body = '';
  req.on('data', function (data) {
      body += data;
  });
  req.on('end', function () {
    var post_params = qs.parse(body);
    for (key in post_params) {
      params[key] = post_params[key];
    };

    if (['POST', 'DELETE'].includes(params.http_method)) {
      req.method = params.http_method;
    }
    
    var routes;
    
    switch(req.method) {
      case 'HEAD':
        routes = main.get;
        var routing_target = routes[url_info.pathname]
        if (routing_target) {
          res.writeHead(
            200, 
            {
              'Content-Type': "application/json; charset=UTF-8",
              'Access-Control-Allow-Origin': '*'
            }
          );
        } else {
          res.writeHead(
            404, 
            {
              'Access-Control-Allow-Origin': '*'
            }
          );
        }
        res.end(body);
        return
        break;
        
      case 'GET':
        routes = main.get;
        break;
        
      case 'DELETE':
        // delete requests are handled like post request with parameter delete=1
        params.delete = '1';

      case 'POST':
        routes = main.post;
        break;
        
      default:
        main.respond('json', null, req, res, 'not found');
        return;
        break;
        
    };

    // dispatch request based on method and url
    if (routes) {
      var routing_target = routes[url_info.pathname]
      if (routing_target) {
        db.query(config.connectionString, req, res, 'START TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE', function (result, conn) {
          routing_target.apply(this, [conn, req, res, params]);
        });
        return;
      }
    }

    main.respond('json', null, req, res, 'not found');
   
  });
  
// actually connect the http server to a network interface
}).listen(config.bind_port, config.bind_address);

console.log('LiquidFeedback API server started with ' + config.public_access_level + ' public access at ' + config.bind_address + ':' + config.bind_port);



