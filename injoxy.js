
var proxy = {
		http_server: null,
		start: function(config) {
			var http = require('http');
			var sys = require('sys');
			
			this.http_server = http.createServer(function(request, response) {
				sys.log(request.connection.remoteAddress + ": " + request.method + " " + request.url);
				
				var host = request.headers['host'];
				var p = host.indexOf(':');
				if (p >= 0) {
					port = host.substr(p + 1);
					host = host.substr(0, p);
				}
				else {
					port = 80;
				}
				
				var proxy = http.createClient(port, host);
				if (config.settings.no_encoding && request.headers['accept-encoding']) {
						request.headers['accept-encoding'] = '';
				}
				var proxy_request = proxy.request(request.method, request.url, request.headers);
				
				proxy.addListener('error', function(err) {
					sys.log('Error occured: ' + err.message);
					var headers = {'Content-type': 'text/html'};
					response.writeHead(401, headers);
					response.write("injoxy: " + err.message + "<br />");
					response.write("URL: <a href=\"" + request.url + "\">" + request.url + "</a>");
					response.end();
					return;
				});
				
				proxy_request.addListener('response', function (proxy_response) {
					var response_buffer = '';
					var patterns_matched = [];
					proxy_response.addListener('data', function(chunk) {
						for (var i = 0; i < config.patterns.length; i++) {
							var pattern = config.patterns[i];
							console.log(pattern.url, request.url.indexOf(pattern.url));
							if ((pattern.url_match == 'equals' && request.url == pattern.url) || 
								(pattern.url_match == 'includes' && request.url.indexOf(pattern.url) >= 0)) {
								response_buffer += chunk.toString();
								patterns_matched[patterns_matched.length] = pattern;
								return;
							}
						}
						response.write(chunk);
					});
					proxy_response.addListener('end', function() {
						if (response_buffer.length > 0) {
							for (var i = 0; i < patterns_matched.length; i++) {
								var pattern = patterns_matched[i];
								var repl_str = '';
								if (pattern.inject_method == 'before') repl_str = pattern.inject + pattern.search;
								else if (pattern.inject_method == 'after') repl_str = pattern.search + pattern.inject;
								else if (pattern.inject_method == 'replace') repl_str = pattern.inject;
								response_buffer = response_buffer.replace(new RegExp(pattern.search, 'g'), repl_str);
							}
							response.write(response_buffer);
						}
						response.end();
					});
					
					if (config.settings.bust_cache) {
						proxy_response.headers['expires'] = 'Mon, 23 Apr 1979 12:35:00 GMT';
						proxy_response.headers['cache-control'] = 'no-cache, max-age: 0';
					}
					proxy_response.headers['connection'] = 'Close';
					
					response.writeHead(proxy_response.statusCode, proxy_response.headers);
				});
				request.addListener('data', function(chunk) {
					proxy_request.write(chunk);
				});
				request.addListener('end', function() {
					proxy_request.end();
				});
			});
			this.http_server.listen(config.settings.proxy_port);
		},
		stop: function() {
			this.http_server.close();
		}
	};

var config_file;
if (process.argv.length > 2) {
	config_file = process.argv[2];
}
else {
	config_file = 'config.json';
}

var fs = require('fs');
var sys = require('sys');
function load_config(filename) {
	return JSON.parse(fs.readFileSync(filename));
}

var config;
try {
	config = load_config(config_file);
}
catch (e) {
	sys.log("Error reading/parsing config file: " + config_file);
	sys.log(e);
	process.exit();
}
proxy.start(config);

fs.watchFile(config_file, {persistent: true, interval: 1000}, function (curr, prev) {
	if (curr.mtime.getTime() == prev.mtime.getTime()) return;
	sys.log("Config file change detected, restarting");
	try {
		config = load_config(config_file);
	}
	catch (e) {
		sys.log("Error reading/parsing config file: " + config_file);
		sys.log(e);
		return null;
	}
	proxy.stop();
	proxy.start(config);
});
