function stringthesizer(options, struct) {
  // options:
  // nextPlaceholder (function)
  // valueSeparator (string)
  // coerce (function)
  var cmdParts = [];
  var args = [];
  var process = function(struct, skipCoercion) {
    if (struct instanceof Array) {
      var structIdx = 0;
      var next = function() { return struct[structIdx++]; };
      next().match(/[^?$]+|\?\??\??|\$\$?\$?/g).forEach(function(stringPart) {
        if (stringPart == "?") {
          cmdParts.push(options.nextPlaceholder(args.length));
          args.push(next())
        } else if (stringPart == "??") {
          var first = true;
          next().forEach(function(entry) {
            if (first) first = false;
            else cmdParts.push(options.valueSeparator);
            cmdParts.push(options.nextPlaceholder(args.length));
            args.push(entry)
          });
        } else if (stringPart == "???") {
          cmdParts.push("?");
        } else if (stringPart == "$") {
          process(next());
        } else if (stringPart == "$$") {
          var sep = next();
          var first = true;
          next().forEach(function(entry) {
            if (first) first = false;
            else cmdParts.push(sep);
            process(entry);
          });
        } else if (stringPart == "$$$") {
          cmdParts.push("$");
        } else {
          cmdParts.push(stringPart);
        }
      });
      if (structIdx != struct.length) { throw "Wrong argument count for stringthesizer"; }
    } else if (skipCoercion || typeof (struct) == 'string') {
      cmdParts.push(struct);
    } else {
      process(options.coerce(struct), true);
    }
  }
  process(struct);
  return { cmd: cmdParts.join(""), args: args };
}

exports.stringthesizer = stringthesizer;