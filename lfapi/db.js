pg = require('pg');
exports.pg = pg;

selector = require('../lib/selector.js');
exports.selector = selector;


// ==========================================================================
// Database access helper function
// --------------------------------------------------------------------------


// executes a db query and call given callback function if suceeded
exports.query = function (conn, req, res, query_object, callback) {
  if (!conn || !query_object) {
    callback(null, conn);
    return;
  };
  if (typeof(conn) == 'string') {
    // connect to database
    conn = pg.connect(conn, function(err, conn) {
      // TODO error handling
      if(err) {
        console.log(err);
      };
      exports.query(conn, req, res, query_object, callback);
    });
    return;
  };
  if (query_object instanceof selector.Upserter) {
    exports.query(conn, req, res, query_object.getSelector(), function(result, conn) {
      if (result.rows.length > 1) {
        exports.error_handler('json', conn, req, res, "error", null, "Multiple rows found for primary key.");
      } else if (result.rows.length == 1) {
        exports.query(conn, req, res, query_object.getSQLUpdate(), callback);
      } else {
        exports.query(conn, req, res, query_object.getSQLInsert(), callback);
      }
      
    });
    
  } else {
    var query;

    if (typeof(query_object) == 'string') {
      query = { cmd: query_object, args: {} };
    } else {
      query = query_object.assemble(function(i) { return ('$' + (i + 1)); });
    }
    
    //console.log('  > SQL: ', query.cmd, query.args ? query.args : '');
    
    conn.query(query.cmd, query.args, function(err, result) {
      if (err) {
        console.log(err);
        exports.error_handler('json', conn, req, res, "error", null, err.message);
      } else {
        callback(result, conn);
      }
    });
  }
}
