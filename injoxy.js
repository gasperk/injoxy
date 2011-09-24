
var proxy = {
	http_server: null,
	start: function(config) {
		var http = require('http');
		var sys = require('sys');
		
		var settings = config.settings;
		var patterns = config.patterns;
		
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
			
			if (settings.no_encoding && request.headers['accept-encoding']) {
					request.headers['accept-encoding'] = '';
			}
			
			var proxy_request = proxy.request(request.method, request.url, request.headers);
			proxy_request.addListener('response', function (proxy_response) {
				var response_buffer = '';
				
				proxy_response.addListener('data', function(chunk) {
					for (var i = 0; i < patterns.length; i++) {
						var pattern = patterns[i];
						if ((pattern.url_match == 'equals' && request.url == pattern.url) || 
							(pattern.url_match == 'includes' && request.url.indexOf(pattern.url) >= 0)) {
							response_buffer += chunk.toString();
							return;
						}
					}
					response.write(chunk);
				});
				proxy_response.addListener('end', function() {
					if (response_buffer.length > 0) {
						console.log("Injecting something");
						for (var i = 0; i < patterns.length; i++) {
							var pattern = patterns[i];
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
				
				if (settings.bust_cache) {
					proxy_response.headers['expires'] = 'Mon, 23 Apr 1979 12:35:00 GMT';
					proxy_response.headers['cache-control'] = 'no-cache, max-age: 0';
				}
				
				response.writeHead(proxy_response.statusCode, proxy_response.headers);
			});
			request.addListener('data', function(chunk) {
				proxy_request.write(chunk);
			});
			request.addListener('end', function() {
				proxy_request.end();
			});
		});
		this.http_server.listen(settings.proxy_port);
	},
	stop: function() {
		this.http_server.close();
	},
	restart: function(config) {
		this.stop();
		this.start(config);
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

fs.watchFile(config_file, {persistent: true, interval: 1000}, function(curr, prev) {
	sys.log("Config file change detected, restarting");
	var config;
	try {
		config = load_config(config_file);
	}
	catch (e) {
		sys.log("Error reading/parsing config file: " + config_file);
		sys.log(e);
		return null;
	}
	proxy.restart(config);
});
