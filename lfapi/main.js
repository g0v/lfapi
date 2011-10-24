var api_version = '0.2.0';

// creates a random string with the given length
function randomString(number_of_chars) {
  var charset, rand, i, ret;
  charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  random_string = '';

  for (var i = 0; i < number_of_chars; i++) {
    random_string += charset[parseInt(Math.random() * charset.length)]
  }
  return random_string;
}

var fields = require('./fields.js');

var general_params = require('./general_params.js');

var config = general_params.config;
exports.config = config;

var db = require('./db.js');
exports.db = db;

var selector = db.selector;

var nodemailer = require('nodemailer');


// check if current session has at least given access level, returns error to client if not.
// used by request handlers below
function requireAccessLevel(conn, req, res, access_level, callback) {
  switch (access_level) {
    case 'anonymous':
      if (req.current_access_level == 'anonymous') { callback(); return; };
    case 'pseudonym':
      if (req.current_access_level == 'pseudonym') { callback(); return; };
    case 'full':
      if (req.current_access_level == 'full') { callback(); return; };
    case 'member':
      if (req.current_member_id) { callback(); return; };
    default:
      respond('json', conn, req, res, 'forbidden', { error: 'Access denied' });
  }
};

// callback function, encoding result and sending it to the client
function respond(mode, conn, req, res, status, object, err) {
  var http_status = 200;
  var command;

  if (status == 'ok') {
    command = 'COMMIT';
  } else {
    command = 'ROLLBACK';
  };
  
  switch (status) {
    case 'ok':
      http_status = 200;
      break;
    case 'forbidden':
      //http_status = 403;
      break;
    case 'notfound':
      http_status = 404;
      break;
    case 'unprocessable':
      //http_status = 422;
      break;
    case 'conflict':
      //http_status = 409;
      break;
  };
  
  var query;
  if (mode == 'json' && ! err) query = 'SELECT null';
  db.query(conn, req, res, query, function(result, conn) {
    db.query(conn, req, res, command, function (result, conn) {
      
      if (mode == 'json') {
        if (! object) object = {};
      } else if (mode == 'html') {
        if (! object) object = 'no content';
        if (err) object = "Error: " + err;
      }
             
      object.status = status;
      object.error = err;

      if (mode == 'json') {
        var body = JSON.stringify(object);
        var content_type = 'application/json';
        if (req.params && req.params.callback) {
          body = req.params.callback + '(' + body + ')';
          content_type = 'text/javascript';
        }
        res.writeHead(
          http_status, 
          {
            'Content-Type': content_type,
            //'Content-Length': body.length // TODO doesn't work in chrome with JSONP
          }
        );
        res.end(body);
      } else if (mode == 'html') {
        var body = ['<html><head><title>lfapi</title><style>body { font-family: sans-serif; }</style></head><body>']
        body.push(object)
        body.push('</body></html>')
        body = body.join('');
        res.writeHead(
          http_status, 
          {
            'Content-Type': 'text/html',
            'Content-Length': body.length
          }
        );
        res.end(body);
      }
    })
  });
};

exports.respond = respond;
db.error_handler = respond;

// add requested related data for requests with include_* parameters
function addRelatedData(conn, req, res, result, includes) {
  if (includes.length > 0) {
    var include = includes.shift();
    var class = include.class;
    var objects = result[include.objects];

    var query;

    if (objects) {
      var objects_exists = false;
      var ids_hash = {};
      if (typeof(objects) == 'array') {
        if (objects.length > 0) {
          objects_exists = true;
          objects.forEach( function(object) {
            if (object[class + "_id"]) {
              ids_hash[object[class + "_id"]] = true;
            };
          });
        }
      } else {
        for (var key in objects) {
          objects_exists = true;
          var object = objects[key];
          if (object[class + "_id"]) {
            ids_hash[object[class + "_id"]] = true;
          };
        };
      };
      
      if (objects_exists) {
        var ids = [];
        for (key in ids_hash) {
          ids.push(key)
        }
        if (ids.length > 0) {
          query = new selector.Selector();
          query.from(class);
          query.addWhere([class + '.id IN (??)', ids]);
          fields.addObjectFields(query, class);
        }
      };
    };

    db.query(conn, req, res, query, function (result2, conn) {
      // add result to main result, regarding correct pluralization
      var tmp = {};
      if (result2) {
        result2.rows.forEach( function(row) {
          tmp[row.id] = row;
        });
      };
             
      if (class == 'policy') {
        result['policies'] = tmp;
      } else {
        result[class + 's'] = tmp;
      }
      addRelatedData(conn, req, res, result, includes);
    });
  } else {
    respond('json', conn, req, res, 'ok', result);
  };
    
};

function lockMemberById(conn, req, res, member_id, callback) {
  var query = new selector.Selector('member');
  query.addField('NULL');
  query.addWhere(['member.id = ?', member_id]);
  query.forUpdate();
  db.query(conn, req, res, query, callback);
};

function requireUnitPrivilege(conn, req, res, unit_id, callback) {
  var query = new selector.Selector('privilege');
  query.addField('NULL');
  query.addWhere(['privilege.member_id = ?', req.current_member_id]);
  query.addWhere(['privilege.unit_id = ?', unit_id ]);
  query.addWhere('privilege.voting_right');
  query.forShareOf('privilege');
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'You have no voting right for this unit.');
      return;
    }
    callback();
  });
};    

function requireAreaPrivilege(conn, req, res, area_id, callback) {
  var query = new selector.Selector('privilege');
  query.join('area', null, 'area.unit_id = privilege.unit_id');
  query.addField('NULL');
  query.addWhere(['privilege.member_id = ?', req.current_member_id]);
  query.addWhere(['area.id = ?', area_id ]);
  query.addWhere('privilege.voting_right');
  query.forShareOf('privilege');
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'You have no voting right for areas in this unit.');
      return;
    }
    callback();
  });
};    

function requireIssuePrivilege(conn, req, res, issue_id, callback) {
  var query = new selector.Selector('privilege');
  query.join('area', null, 'area.unit_id = privilege.unit_id');
  query.join('issue', null, 'issue.area_id = area.id');
  query.addField('NULL');
  query.addWhere(['privilege.member_id = ?', req.current_member_id]);
  query.addWhere(['issue.id = ?', issue_id ]);
  query.addWhere('privilege.voting_right');
  query.forShareOf('privilege');
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'You have no voting right for issues in this unit.');
      return;
    }
    callback();
  });
};    

function requireInitiativePrivilege(conn, req, res, initiative_id, callback) {
  var query = new selector.Selector('privilege');
  query.join('area', null, 'area.unit_id = privilege.unit_id');
  query.join('issue', null, 'issue.area_id = area.id');
  query.join('initiative', null, 'initiative.issue_id = issue.id');
  query.addField('NULL');
  query.addWhere(['privilege.member_id = ?', req.current_member_id]);
  query.addWhere(['initiative.id = ?', initiative_id ]);
  query.addWhere('privilege.voting_right');
  query.forShareOf('privilege');
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'You have no voting right for initiatives in this unit.');
      return;
    }
    callback();
  });
};    

function requireIssueState(conn, req, res, issue_id, required_states, callback) {
  var query = new selector.Selector('issue');
  query.addField('NULL');
  query.addWhere(['issue.id = ?', issue_id]);
  query.addWhere(['issue.state IN (??)', required_states]);
  query.forUpdateOf('issue');
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'Issue is in wrong state.');
      return;
    }
    callback();
  });
};

function requireIssueStateForInitiative(conn, req, res, initiative_id, required_states, callback) {
  var query = new selector.Selector('issue');
  query.join('initiative', null, 'initiative.issue_id = issue.id');
  query.addField('NULL');
  query.addWhere(['initiative.id = ?', initiative_id]);
  query.addWhere(['issue.state IN (??)', required_states]);
  query.forUpdateOf('issue');
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'Issue is in wrong state.');
      return;
    }
    callback();
  });
}

function requireContingentLeft(conn, req, res, is_initiative, callback) {
  var query = new selector.Selector('member_contingent_left');
  query.addField('NULL');
  query.addWhere(['member_contingent_left.member_id = ?', req.current_member_id]);
  query.addWhere('member_contingent_left.text_entries_left >= 1');
  if (is_initiative) {
    query.addWhere('member_contingent_left.initiatives_left >= 1');
  }
  db.query(conn, req, res, query, function(result, conn) {
    if (result.rows.length != 1) {
      respond('json', conn, req, res, 'forbidden', null, 'Contingent empty.');
      return;
    }
    callback();
  });
}

// ==========================================================================
// GETT methods
// ==========================================================================


exports.get = {

  // startpage (html) for users
  // currently used for implementing public alpha test
  '/': function (conn, req, res, params) {
    
    var html = [];
    html.push('<h2>welcome to lfapi public developer alpha test</h2>');
    html.push('<p>This service is provided for testing purposes and is <i><b>dedicated to developers interested in creating applications</b></i> based on LiquidFeedback.</p>');
    html.push('<h2>how to use</h2>');
    html.push('<p>The programming interface is described in the <a href="http://dev.liquidfeedback.org/trac/lf/wiki/API">LiquidFeedback API specification</a>.</p>')
    html.push('<p>The current implementation status of lfapi is published at the <a href="http://dev.liquidfeedback.org/trac/lf/wiki/lfapi">LiquidFeedback API server</a> page in our Wiki.</p>');
    html.push('<p><b><i>Neither the API specification nor the implementation of lfapi is finished yet.</i></b> This public test should enable developers to join the specification process of the programming interface and makes it possible to start creating applications.</p>');
    html.push('<h2>questions and suggestions</h2>');
    html.push('<p>Please use our <a href="http://dev.liquidfeedback.org/cgi-bin/mailman/listinfo/main">public mailing list</a> if you have any questions or suggestions.</p>');
    html.push('<h2>developer registration</h2>');
    html.push('<p>To register as developer and receive an account, please submit the following form. You\'ll receive an email with instructions to complete the registration process by verifying your email address.<br />');
    html.push('<form action="register_test" method="POST">');
    html.push('<label for="name">Your name:</label> <input type="text" id="name" name="name" /> &nbsp; &nbsp; ');
    html.push('<label for="email">Email address:</label> <input type="text" id="email" name="email" /> &nbsp; &nbsp; ');
    html.push('<label for="location">Location:</label> <select name="location" id="location"><option value="earth">Earth</option><option value="moon">Moon</option><option value="mars">Mars</option></select>');
    html.push('<br />');
    html.push('<br />');
    html.push('<div style="border: 2px solid #c00000; background-color: #ffa0a0; padding: 1ex;">');
    html.push('<b>WARNING:</b> All data you entered above and all data you enter later while using the system and all data you are submitting via the programming interface will be stored in the LiquidFeedback database and published. Every access to the system is subject of tracing and logging for development purposes.<br />Please notice, this is a <b>public alpha test dedicated to developers</b>: serious errors can happen, private data unintentionally published or even <a href="http://en.wikipedia.org/wiki/Grey_goo"> grey goo</a> can appear without further warning. Everything is <b>ON YOUR OWN RISK</b>!');
    html.push('<br />');
    html.push('<br />');
    html.push('<input type="checkbox" name="understood" value="understood" /> I understand the previous warning  and I understand that everything is on my own risk.<br />');
    html.push('</div>');
    html.push('<br />');
    html.push('<input type="submit" value="Register account" />');
    respond('html', null, req, res, 'ok', html.join(''));
  },
  
  // temporary method to implement public alpha test
  '/register_test_confirm': function (conn, req, res, params) {
    var secret = params.secret;

    var query = new selector.Selector('member');
    query.addField('member.id, member.notify_email_unconfirmed');
    query.addWhere(['member.notify_email_secret = ?', secret]);
    db.query(conn, req, res, query, function (result, conn) {
      var member = result.rows[0];
      if (member) {
        var query = new selector.SQLUpdate('member');
        query.addValues({
          notify_email: member.notify_email_unconfirmed,
          notify_email_secret: null,
          notify_email_unconfirmed: null,
          active: true,
          activated: 'now',
          active: true,
          last_activity: 'now',
          locked: false
        });
        query.addWhere(['id = ?', member.id]);
        db.query(conn, req, res, query, function (err, result) {
          respond('html', conn, req, res, 'ok', 'Account activated: ');
        });
      } else {
        respond('html', conn, req, res, 'forbidden', 'Secret not valid or already used.');
      }
    })
  },
  
  '/info': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('"liquid_feedback_version"');
      query.addField('"liquid_feedback_version".*');
      db.query(conn, req, res, query, function (result, conn) {
        var liquid_feedback_version = result.rows[0];
        var query = new selector.Selector();
        query.from('"system_setting"');
        query.addField('"member_ttl"');
        db.query(conn, req, res, query, function (result, conn) {
          var member_ttl = null;
          if (result.rows[0]) {
            member_ttl = result.rows[0].member_ttl;
          };
          respond('json', conn, req, res, 'ok', {
            core_version: liquid_feedback_version.string,
            api_version: api_version,
            current_access_level: req.current_member_id ? 'member' : req.current_access_level,
            current_member_id: req.current_member_id,
            member_ttl: member_ttl,
            settings: config.settings
          });
        });
      });
    });
  },
  
  '/member_count': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('"member_count"');
      query.addField('"member_count".*');
      db.query(conn, req, res, query, function (result, conn) {
        var member_count = result.rows[0];
        respond('json', conn, req, res, 'ok', {
          total_count: member_count.total_count,
          calculated: member_count.calculated
        });
      });
    });
  },
  
  '/contingent': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {          
      var query = new selector.Selector();
      query.from('"contingent"');
      query.addField('"contingent".*');
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },
  
  '/contingent_left': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {          
      var query = new selector.Selector();
      query.from('"member_contingent_left"');
      query.addField('"member_contingent_left".text_entries_left');
      query.addField('"member_contingent_left".initiatives_left');
      query.addWhere(['member_id = ?', req.current_member_id]);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows[0] });
      });
    });
  },
  
  '/member': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      query.from('"member"');
      if (req.current_access_level == 'pseudonym' && !req.current_member_id ) {
        fields.addObjectFields(query, 'member', 'member_pseudonym');
      } else {
        fields.addObjectFields(query, 'member');
      }
      general_params.addMemberOptions(req, query, params);
      query.addOrderBy('"member"."id"');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },
  
  '/member_history': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'full', function() {
      var query = new selector.Selector();
      query.from('"member_history" JOIN "member" ON "member"."id" = "member_history"."member_id"');
      query.addField('"member_history".*');
      general_params.addMemberOptions(req, query, params);
      query.addOrderBy('member_history.id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (member_history_result, conn) {
        var result = { result: member_history_result.rows }
        includes = [];
        if (params.include_members) includes.push({ class: 'member', objects: 'result'});
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/member_image': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'full', function() {
      var query = new selector.Selector();
      query.from('"member_image" JOIN "member" ON "member"."id" = "member_image"."member_id"');
      query.addField('"member_image".*');
      query.addWhere('member_image.scaled');
      general_params.addMemberOptions(req, query, params);
      query.addOrderBy = ['member_image.member_id, member_image.image_type'];
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },
  
  '/contact': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      query.from('contact JOIN member ON member.id = contact.member_id');
      query.addField('"contact".*');
      if (req.current_member_id) {
        // public or own for members
        query.addWhere(['"contact"."public" OR "contact"."member_id" = ?', req.current_member_id]);
      } else {
        // public for everybody
        query.addWhere('"contact"."public"');
      }
      general_params.addMemberOptions(req, query, params);
      query.addOrderBy('"contact"."id"');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },

  '/privilege': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      query.from('privilege JOIN member ON member.id = privilege.member_id JOIN unit ON unit.id = privilege.unit_id');
      query.addField('privilege.*');
      general_params.addUnitOptions(req, query, params);
      general_params.addMemberOptions(req, query, params);
      query.addOrderBy('privilege.unit_id, privilege.member_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (privilege_result, conn) {
        var result = { result: privilege_result.rows }
        includes = [];
        if (params.include_units) includes.push({ class: 'unit', objects: 'result'});
        if (params.include_members) includes.push({ class: 'member', objects: 'result'});
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/policy': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('"policy"');
      query.addField('"policy".*');
      general_params.addPolicyOptions(req, query, params);
      query.addOrderBy('"policy"."index"');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },
  
  '/unit': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {          
      var query = new selector.Selector();
      query.from('"unit"');
      fields.addObjectFields(query, 'unit');
      general_params.addUnitOptions(req, query, params);
      query.addOrderBy('unit.id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },
  
  '/area': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('area JOIN unit ON area.unit_id = unit.id');
      fields.addObjectFields(query, 'area');
      general_params.addAreaOptions(req, query, params);
      query.addOrderBy('area.id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (area_result, conn) {
        var result = { result: area_result.rows }
        includes = [];
        if (params.include_units) includes.push({ class: 'unit', objects: 'result'});
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/allowed_policy': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
    var query = new selector.Selector();
    query.from('allowed_policy');
    query.join('area', null, 'area.id = allowed_policy.area_id');
    query.join('unit', null, 'unit.id = area.unit_id');
    query.addField('allowed_policy.*');
    general_params.addAreaOptions(req, query, params);
    query.addOrderBy('allowed_policy.area_id, allowed_policy.policy_id');
    general_params.addLimitAndOffset(query, params);
    db.query(conn, req, res, query, function (allowed_policy_result, conn) {
      var result = { result: allowed_policy_result.rows }
      includes = [];
      if (params.include_policies) includes.push({ class: 'policy', objects: 'result'});
      if (params.include_areas) includes.push({ class: 'area', objects: 'result'});
      if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
      addRelatedData(conn, req, res, result, includes);
    });
  }); },
  
  '/membership': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      query.from('membership JOIN member ON membership.member_id = member.id JOIN area ON area.id = membership.area_id JOIN unit ON unit.id = area.unit_id');
      query.addField('membership.*');
      general_params.addAreaOptions(req, query, params);
      general_params.addMemberOptions(req, query, params);
      query.addOrderBy('membership.area_id, membership.member_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (membership_result, conn) {
        var result = { result: membership_result.rows }
        includes = [];
        if (params.include_members) includes.push({ class: 'member', objects: 'result'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'result'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/issue': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector()
      query.from('issue JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      fields.addObjectFields(query, 'issue');
      general_params.addIssueOptions(req, query, params);
      query.addOrderBy('issue.id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (issue_result, conn) {
        var result = { result: issue_result.rows }
        includes = [];
        if (params.include_areas) includes.push({ class: 'area', objects: 'result'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'result' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },

  '/interest': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      if (!params.snapshot) {
        query.from('interest');
      } else if (params.snapshot == 'latest') {
        query.from('direct_interest_snapshot', 'interest');
        query.addWhere('interest.event = issue.latest_snapshot_event');
      };
      query.addField('interest.*');
      query.join('member', null, 'member.id = interest.member_id');
      query.join('issue', null, 'interest.issue_id = issue.id');
      query.join('policy', null, 'policy.id = issue.policy_id');
      query.join('area', null, 'area.id = issue.area_id');
      query.join('unit', null, 'area.unit_id = unit.id');
      general_params.addMemberOptions(req, query, params);
      general_params.addIssueOptions(req, query, params);
      query.addOrderBy('interest.issue_id, interest.member_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (interest_result, conn) {
        var result = { result: interest_result.rows }
        includes = [];
        if (params.include_members) includes.push({ class: 'member', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'result'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/issue_comment': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      query.from('issue_comment JOIN member ON member.id = issue_comment.member_id JOIN issue on issue_comment.issue_id = issue.id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      query.addField('issue_comment.*');
      general_params.addMemberOptions(req, query, params);
      general_params.addIssueOptions(req, query, params);
      query.addOrderBy('issue_comment.issue_id, issue_comment.member_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (issue_comment_result, conn) {
        var result = { result: issue_comment_result.rows }
        includes = [];
        if (params.include_members) includes.push({ class: 'member', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'result'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/initiative': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('initiative JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      fields.addObjectFields(query, 'initiative');
      query.addOrderBy('initiative.id');
      general_params.addInitiativeOptions(req, query, params);
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (initiative_result, conn) {
        var result = { result: initiative_result.rows }
        includes = [];
        if (params.include_issues) includes.push({ class: 'issue', objects: 'result'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },

  '/initiator': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var fields = ['initiator.initiative_id', 'initiator.member_id'];
      var query = new selector.Selector();
      query.from('initiator JOIN member ON member.id = initiator.member_id JOIN initiative ON initiative.id = initiator.initiative_id JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      query.addWhere('initiator.accepted');
      fields.forEach( function(field) {
        query.addField(field, null, ['grouped']);
      });
      general_params.addMemberOptions(req, query, params);
      general_params.addInitiativeOptions(req, query, params);
      query.addOrderBy('initiator.initiative_id, initiator.member_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (initiator, conn) {
        var result = { result: initiator.rows }
        includes = [];
        if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'initiatives'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },


  '/supporter': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var fields = ['supporter.issue_id', 'supporter.initiative_id', 'supporter.member_id', 'supporter.draft_id'];
      var query = new selector.Selector();
      query.from('supporter')
      query.join('member', null, 'member.id = supporter.member_id JOIN initiative ON initiative.id = supporter.initiative_id JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      fields.forEach( function(field) {
        query.addField(field, null, ['grouped']);
      });
      general_params.addMemberOptions(req, query, params);
      general_params.addInitiativeOptions(req, query, params);
      query.addOrderBy('supporter.issue_id, supporter.initiative_id, supporter.member_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (supporter, conn) {
        var result = { result: supporter.rows }
        includes = [];
        if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'initiatives'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/battle': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('battle JOIN initiative ON initiative.id = battle.winning_initiative_id OR initiative.id = battle.losing_initiative_id JOIN issue ON issue.id = battle.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      query.addField('battle.*');
      general_params.addInitiativeOptions(req, query, params);
      query.addOrderBy('battle.issue_id, battle.winning_initiative_id, battle.losing_initiative_id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        var result = { result: result.rows }
        includes = [];
        if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'initiatives'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/draft': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var fields = ['draft.initiative_id', 'draft.id', 'draft.formatting_engine', 'draft.content', 'draft.author_id'];
      var query = new selector.Selector();
      query.from('draft JOIN initiative ON initiative.id = draft.initiative_id JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      fields.forEach( function(field) {
        query.addField(field, null, ['grouped']);
      });
      if (req.current_access_level != 'anonymous' || req.current_member_id) {
        query.addField('draft.author_id');
      }
      if (params.draft_id) {
        query.addWhere('draft.id = ?', params.draft_id);
      }
      if (params.current_draft) {
        query.join('current_draft', null, 'current_draft.initiative_id = initiative.id AND current_draft.id = draft.id')
      }
      general_params.addInitiativeOptions(req, query, params);
      query.addOrderBy('draft.initiative_id, draft.id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        var result = { result: result.rows }
        includes = [];
        if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'initiatives'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/suggestion': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'anonymous', function() {
      var query = new selector.Selector();
      query.from('suggestion JOIN initiative ON initiative.id = suggestion.initiative_id JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      if (req.current_access_level == 'anonymous' && !req.current_member_id ) {
        fields.addObjectFields(query, 'suggestion', 'suggestion_pseudonym');
      } else {
        fields.addObjectFields(query, 'suggestion');
      }
      general_params.addSuggestionOptions(req, query, params);
      query.addOrderBy('suggestion.initiative_id, suggestion.id');
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        var result = { result: result.rows }
        includes = [];
        if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'result'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'initiatives'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
    
  '/opinion': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var fields = ['opinion.initiative_id', 'opinion.suggestion_id', 'opinion.member_id', 'opinion.degree', 'opinion.fulfilled']
      var query = new selector.Selector();
      query.from('opinion JOIN member ON member.id = opinion.member_id JOIN suggestion ON suggestion.id = opinion.suggestion_id JOIN initiative ON initiative.id = suggestion.initiative_id JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      fields.forEach( function(field) {
        query.addField(field, null, ['grouped']);
      });
      general_params.addMemberOptions(req, query, params);
      general_params.addSuggestionOptions(req, query, params);
      query.addOrderBy = ['opinion.initiative_id, opinion.suggestion_id, opinion.member_id'];
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        var result = { result: result.rows }
        includes = [];
        if (params.include_suggestions) includes.push({ class: 'suggestion', objects: 'result'});
        if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'suggestions'});
        if (params.include_issues) includes.push({ class: 'issue', objects: 'initiatives'});
        if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
        if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
        if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
        addRelatedData(conn, req, res, result, includes);
      });
    });
  },
  
  '/delegation': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var fields = ['delegation.id', 'delegation.truster_id', 'delegation.trustee_id', 'delegation.scope', 'delegation.area_id', 'delegation.issue_id', 'delegation.unit_id'];
      var query = new selector.Selector();
      query.from('delegation LEFT JOIN issue on delegation.issue_id = issue.id LEFT JOIN policy ON policy.id = issue.policy_id LEFT JOIN area ON area.id = issue.area_id OR area.id = delegation.area_id LEFT JOIN unit ON area.unit_id = unit.id OR unit.id = delegation.unit_id');
      fields.forEach( function(field) {
        query.addField(field, null, ['grouped']);
      });
      if (params.direction) {
        switch (params.direction) {
          case 'in':
            query.join('member', null, 'member.id = delegation.trustee_id');
            break;
          case 'out':
            query.join('member', null, 'member.id = delegation.truster_id');
            break;
          default:
            respond('json', conn, req, res, 'unprocessable', 'Direction must be "in" or "out" if set.');
        }
      } else {
        query.join('member', null, 'member.id = delegation.truster_id OR member.id = delegation.trustee_id');
      }
      general_params.addMemberOptions(req, query, params);
      general_params.addIssueOptions(req, query, params);
      if (params.scope) {
        query.addWhere(['delegation.scope IN (??)', params.scope.split(',')]);
      };
      query.addOrderBy = ['delegation.id'];
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },

  '/vote': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'pseudonym', function() {
      var query = new selector.Selector();
      query.from('vote JOIN member ON member.id = vote.member_id JOIN initiative ON initiative.id = vote.initiative_id JOIN issue ON issue.id = initiative.issue_id JOIN policy ON policy.id = issue.policy_id JOIN area ON area.id = issue.area_id JOIN unit ON area.unit_id = unit.id');
      query.addField('vote.*');
      query.addWhere('issue.closed_at NOTNULL');
      general_params.addMemberOptions(req, query, params);
      general_params.addInitiativeOptions(req, query, params);
      general_params.addLimitAndOffset(query, params);
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { result: result.rows });
      });
    });
  },
  
  '/event': function (conn, req, res, params) { requireAccessLevel(conn, req, res, 'anonymous', function() {
    var fields = ['event.id', 'event.occurrence', 'event.event', 'event.member_id', 'event.issue_id', 'event.state', 'event.initiative_id', 'event.draft_id', 'event.suggestion_id'];
    var query = new selector.Selector();
    query.from('event LEFT JOIN member ON member.id = event.member_id LEFT JOIN initiative ON initiative.id = event.initiative_id LEFT JOIN issue ON issue.id = event.issue_id LEFT JOIN policy ON policy.id = issue.policy_id LEFT JOIN area ON area.id = issue.area_id LEFT JOIN unit ON area.unit_id = unit.id');
    fields.forEach( function(field) {
      query.addField(field, null, ['grouped']);
    });
    general_params.addMemberOptions(req, query, params);
    general_params.addInitiativeOptions(req, query, params);
    query.addOrderBy('event.id');
    general_params.addLimitAndOffset(query, params);
    db.query(conn, req, res, query, function (events, conn) {
      var result = { result: events.rows }
      includes = [];
      if (params.include_initiatives) includes.push({ class: 'initiative', objects: 'result'});
      if (params.include_issues) includes.push({ class: 'issue', objects: 'result'});
      if (params.include_areas) includes.push({ class: 'area', objects: 'issues'});
      if (params.include_units) includes.push({ class: 'unit', objects: 'areas'});
      if (params.include_policies) includes.push({ class: 'policy', objects: 'issues' });
      addRelatedData(conn, req, res, result, includes);
    });
  }); },
  
  // TODO add interfaces for data structure:
  // event requireAccessLevel(conn, req, res, 'member');
  // ignored_member requireAccessLevel(conn, req, res, 'member');
  // ignored_initiative requireAccessLevel(conn, req, res, 'member');
  // setting requireAccessLevel(conn, req, res, 'member');

};

// ==========================================================================
// POST methods
// ==========================================================================



exports.post = {
  
  '/echo_test': function (conn, req, res, params) { requireAccessLevel(conn, req, res, 'anonymous', function() {
    respond('json', conn, req, res, 'ok', { result: params });
  }); },
  
  '/register_test': function (conn, req, res, params) {
    var understood = params.understood;
    var member_login = randomString(16);
    var member_name = params.name;
    var member_password = randomString(16);
    var member_notify_email = params.email;
    var member_notify_email_secret = randomString(24);
    var api_key_member = randomString(24);
    var api_key_full = randomString(24);
    var api_key_pseudonym = randomString(24);
    var api_key_anonymous = randomString(24);
    
    if (understood != 'understood') {
      respond('html', conn, req, res, 'unprocessable', null, 'You didn\'t checked the checkbox! Please hit back in your browser and try again.');
      return;
    }
    
    // add member
    var query = new selector.SQLInsert('member');
    query.addValues({ 
      login: member_login,
      password: member_password, // TODO hashing of password
      notify_email_unconfirmed: member_notify_email,
      notify_email_secret: member_notify_email_secret,
      name: member_name
    });
    query.addReturning('id');
    db.query(conn, req, res, query, function (result, conn) {
      var member_id = result.rows[0].id;

      // add privilege for root unit
      var query = new selector.SQLInsert('privilege');
      query.addValues({ unit_id: 1, member_id: member_id, voting_right: true });
      db.query(conn, req, res, query, function (result, conn) {

        var location = params.location;
        var unit_id;
        switch(location) {
          case 'earth':
            unit_id = 3;
            break;
          case 'moon': 
            unit_id = 4;
            break;
          case 'mars':
            unit_id = 5;
            break;
        }
        
        // add privilege for selected planet
        var query = new selector.SQLInsert('privilege');
        query.addValues({ unit_id: unit_id, member_id: member_id, voting_right: true });
        db.query(conn, req, res, query, function (result, conn) {

          // add application key
          var query = new selector.SQLInsert('member_application');
          query.addValues({ 
            member_id: member_id,
            name: 'member',
            comment: 'access_level member',
            access_level: 'member',
            key: api_key_member
          });
          query.addReturning('id');
          
          db.query(conn, req, res, query, function (result, conn) {

            nodemail.sendmail = '/usr/bin/sendmail';

            // send email to user
            nodemailer.send_mail({
              from:           config.mail.from,
              subject:        config.mail.subject_prefix + "Your LiquidFeedback API alpha test account needs confirmation",
              to:             member_notify_email,
              body: "\
Hello " + member_name + ",\n\
\n\
thank you for registering at the public alpha test of the LiquidFeedback\n\
application programming interface. To complete the registration process,\n\
you need to confirm your email address by opening the following URL:\n\
\n\
" + config.public_url_path + "register_test_confirm?secret=" + member_notify_email_secret + "\n\
\n\
\n\
After you've confirmed your email address, your account will be automatically\n\
activated.\n\
\n\
Your account name is:     " + member_name + "\n\
\n\
\n\
You will need the following login and password to register and unregister\n\
applications for your account later. This function is currently not\n\
implemented, but please keep the credentials for future use.\n\
\n\
Account ID:               " + member_id + "\n\
Login:                    " + member_login + "\n\
Password:                 " + member_password + "\n\
\n\
\n\
To make you able to actually access the API interface, we added the following\n\
application key with full member access privileges to your account:\n\
\n\
API Key:                  " + api_key_member + "\n\
\n\
\n\
The base address of the public test is: " + config.public_url_path + "\n\
\n\
The programming interface is described in the LiquidFeedback API\n\
specification: http://dev.liquidfeedback.org/trac/lf/wiki/API\n\
\n\
The current implementation status of lfapi is published at the LiquidFeedback\n\
API server page: http://dev.liquidfeedback.org/trac/lf/wiki/lfapi\n\
\n\
If you have any questions or suggestions, please use our public mailing list\n\
at http://dev.liquidfeedback.org/cgi-bin/mailman/listinfo/main\n\
\n\
For issues regarding your test account, contact us via email at\n\
lqfb-maintainers@public-software-group.org\n\
\n\
\n\
Sincerely,\n\
\n\
Your LiquidFeedback maintainers",
            },
            function(err, result){
              if(err){ console.log(err); }
            });        
                
            respond('html', conn, req, res, 'ok', 'Account created. Please check your mailbox!<br /><br /><br /><a href="/">Back to start page</a>');
          });
        });
      });
    });
  },
  
  /*
  '/register': function (conn, req, res, params) {
    var invite_key = params.invite_key;
    var login = params.login;
    var password = params.password;
    var name = params.name;
    var notify_email = params.notify_email;
    if (!invite_key) {
      respond('json', conn, req, res, 'unprocessable', null, 'No invite_key supplied.');
      return;
    };
    if (!login) {
      respond('json', conn, req, res, 'unprocessable', null, 'No login supplied.');
      return;
    };
    if (!password) {
      respond('json', conn, req, res, 'unprocessable', null, 'No password supplied.');
      return;
    };
    if (!name) {
      respond('json', conn, req, res, 'unprocessable', null, 'No name supplied.');
      return;
    };
    if (!notify_email) {
      respond('json', conn, req, res, 'unprocessable', null, 'No notify_email supplied.');
      return;
    };
    // check if akey is valid and get member_id for akey
    db.query(conn, req, res, { select: ['member.id'], from: ['member'], where: ['NOT member.activation AND member.invite_key = ' + db.pgEncode(invite_key)] }, function (result, conn) {
      if (result.rows.length != 1) {
        respond('json', conn, req, res, 'forbidden', null, 'Supplied invite_key is not valid.');
        return;
      };
      var member_id = result.rows[0].id;
      // check if name is available
      db.query(conn, req, res, { select: ['NULL'], from: ['member'], where: ['member.name = ' + db.pgEncode(name)] }, function (result, conn) {
        if (result.rows.length > 0) {
          respond('json', conn, req, res, 'forbidden', null, 'Login name is not available, choose another one.');
          return;
        };
        // check if login is available
        db.query(conn, req, res, { select: ['NULL'], from: ['member'], where: ['member.login = ' + db.pgEncode(login)] }, function (result, conn) {
          if (result.rows.length > 0) {
            respond('json', conn, req, res, 'forbidden', null, 'Name is not available, choose another one.');
            return;
          };
          var query = { update: 'member', set: { activation: 'now', active: true, } };
          
        });
      });
    });
  },
  */
  
  '/session': function (conn, req, res, params) {
    var key = params.key;
    if (!key) {
      respond('json', conn, req, res, 'unprocessable', null, 'No application key supplied.');
      return;
    };
    var query = new selector.Selector();
    query.from('member');
    query.join('member_application', null, 'member_application.member_id = member.id');
    query.addField('member.id');
    query.addWhere(['member.active AND member_application.key = ?', key]);
    if (params.interactive) {
      query.forUpdateOf('member');
    }
    db.query(conn, req, res, query, function (result, conn) {
      if (result.rows.length != 1) {
        respond('json', conn, req, res, 'forbidden', null, 'Supplied application key is not valid.');
        return;
      };
      var member_id = result.rows[0].id;
      var session_key = randomString(16);
      req.sessions[session_key] = member_id;
      var query;
      if (params.interactive) {
        query = new selector.SQLUpdate('member');
        query.addWhere(['member.id = ?', member_id]);
        query.addValues({ last_activity: 'now' });
      }
      db.query(conn, req, res, query, function (result, conn) {
        respond('json', conn, req, res, 'ok', { session_key: session_key });
      });
    });
  },
  
  '/member': function (conn, req, res, params) {
    var fields = ['organizational_unit', 'internal_posts', 'realname', 'birthday', 'address', 'email', 'xmpp_address', 'website', 'phone', 'mobile_phone', 'profession', 'external_memberships', 'external_posts', 'statement']
    requireAccessLevel(conn, req, res, 'member', function() {
      var query = new selector.SQLUpdate('member');
      query.addWhere(['member.id = ?', req.current_member_id]);
      fields.forEach( function(field) {
        if (typeof(params[field]) != 'undefined') {
          query.addValues({ field: params[field] });
        } else {
          query.addValues({ field: null });
        }
      });
      db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });
    });
  },

  '/membership': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {

      // check if area_id is set
      var area_id = parseInt(params.area_id);
      if (!area_id) {
        respond('json', conn, req, res, 'unprocessable', null, 'You need to supply an area_id.');
        return;
      }

      // delete membership
      if (params.delete) {
        var query;
        query = new selector.SQLDelete('membership');
        query.addWhere(['area_id = ?', area_id]);
        query.addWhere(['member_id = ?', req.current_member_id]);
        db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });

      // add membership
      } else {
        
        // lock member for upsert
        lockMemberById(conn, req, res, req.current_member_id, function() {

          // check and lock privilege
          requireAreaPrivilege(conn, req, res, area_id, function() {

            // upsert membership
            var query = new selector.Upserter('membership', ['area_id', 'member_id']);
            query.addValues({ area_id: area_id, member_id: req.current_member_id });
            db.query(conn, req, res, query, function(result) { 
              respond('json', conn, req, res, 'ok');
            });
          });
        });
      }
    });
  },
    
  '/interest': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      var query;

      // check if issue_id is set
      var issue_id = parseInt(params.issue_id);
      if (!issue_id) {
        respond('json', conn, req, res, 'unprocessable', null, 'You need to supply an issue_id.');
        return;
      }

      // lock member for upsert
      lockMemberById(conn, req, res, req.current_member_id, function() {

        // delete interest
        if (params.delete) {

          // check issue state
          requireIssueState(conn, req, res, issue_id, ['admission', 'discussion', 'verification'], function() {

            // delete interest
            query = new selector.SQLDelete('interest');
            query.addWhere(['issue_id = ?', issue_id]);
            query.addWhere(['member_id = ?', req.current_member_id]);
            db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });
          });

        // add interest
        } else {

          // check and lock privilege
          requireIssuePrivilege(conn, req, res, issue_id, function() {

            // check issue state
            requireIssueState(conn, req, res, issue_id, ['admission', 'discussion', 'verification'], function() {

              // upsert interest
              var query = new selector.Upserter('interest', ['issue_id', 'member_id']);
              query.addValues({ issue_id: issue_id, member_id: req.current_member_id });
              db.query(conn, req, res, query, function(result) { 
                respond('json', conn, req, res, 'ok');
              });
            });
          });
        };
      });
    });
  },

  '/issue_comment': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      
      var issue_id = parseInt(params.issue_id);
      var formatting_engine = params.formatting_engine
      var content = params.content;

      if (!issue_id) {
        respond('json', conn, req, res, 'unprocessable', null, 'You need to supply an issue_id.');
        return;
      }

      // delete issue comment
      if (params.delete) {
        var query;
        query = new selector.SQLDelete('issue_comment');
        query.addWhere(['issue_id = ?', params.issue_id]);
        query.addWhere(['member_id = ?', req.current_member_id]);
        db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });

      // upsert issue comment
      } else {

        // check if formatting engine is supplied and valid
        if (!formatting_engine) {
          respond('json', conn, req, res, 'unprocessable', null, 'No formatting engine supplied.');
          return;
        } else if (formatting_engine != 'rocketwiki' && formatting_engine != 'compat') {
          respond('json', conn, req, res, 'unprocessable', null, 'Invalid formatting engine supplied.');
          return;
        };

        // check if content is supplied
        if (!content) {
          respond('json', conn, req, res, 'unprocessable', null, 'No content supplied.');
          return;
        }
        
        // lock member for upsert
        lockMemberById(conn, req, res, req.current_member_id, function() {

          // check and lock privilege
          requireIssuePrivilege(conn, req, res, issue_id, function() {

            // upsert issue comment
            var query = new selector.Upserter('issue_comment', ['issue_id', 'member_id']);
            query.addValues({
              issue_id: issue_id,
              member_id: req.current_member_id,
              changed: 'now',
              formatting_engine: formatting_engine,
              content: content
            });

            db.query(conn, req, res, query, function(result) { 
              respond('json', conn, req, res, 'ok');
            });

          });
        });

      }
      
    });
  },

   '/voting_comment': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      
      var issue_id = parseInt(params.issue_id);
      var formatting_engine = params.formatting_engine
      var content = params.content;

      if (!issue_id) {
        respond('json', conn, req, res, 'unprocessable', null, 'You need to supply an issue_id.');
        return;
      }

        
      // delete voting comment
      if (params.delete) {
        var query;
        query = new selector.SQLDelete('voting_comment');
        query.addWhere(['issue_id = ?', params.issue_id]);
        query.addWhere(['member_id = ?', req.current_member_id]);
        db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });

      // upsert voting comment
      } else {

        // check if formatting engine is supplied and valid
        if (!formatting_engine) {
          respond('json', conn, req, res, 'unprocessable', null, 'No formatting engine supplied.');
          return;
        } else if (formatting_engine != 'rocketwiki' && formatting_engine != 'compat') {
          respond('json', conn, req, res, 'unprocessable', null, 'Invalid formatting engine supplied.');
          return;
        };

        // check if content is supplied
        if (!content) {
          respond('json', conn, req, res, 'unprocessable', null, 'No content supplied.');
          return;
        }
          
        // lock member for upsert
        lockMemberById(conn, req, res, req.current_member_id, function() {

          // check and lock privilege
          requireIssuePrivilege(conn, req, res, issue_id, function() {

            // check issue state
            requireIssueState(conn, req, res, issue_id, ['voting', 'finished_with_winner', 'finished_without_winner'], function() {

              // upsert voting comment
              var query = new selector.Upserter('voting_comment', ['issue_id', 'member_id']);
              query.addValues({
                issue_id: issue_id,
                member_id: req.current_member_id,
                changed: 'now',
                formatting_engine: formatting_engine,
                content: content
              });

              db.query(conn, req, res, query, function(result) { 
                respond('json', conn, req, res, 'ok');
              });

            });
          });
        })
      };
    });
  },

  '/supporter': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      var initiative_id = parseInt(params.initiative_id);
      var draft_id = parseInt(params.draft_id);

      // check if needed arguments are supplied
      if (!initiative_id) {
        respond('json', conn, req, res, 'unprocessable', null, 'You need to supply an initiative_id.');
        return;
      }

      if (!draft_id) {
        respond('json', conn, req, res, 'unprocessable', null, 'You need to supply an draft_id.');
        return;
      }

      // lock member for upsert
      lockMemberById(conn, req, res, req.current_member_id, function() {

        // delete supporter
        if (params.delete) {
          
          // check issue state
          requireIssueStateForInitiative(conn, req, res, initiative_id, ['admission', 'discussion', 'verification'], function() {

            // delete supporter
            var query = new selector.SQLDelete('supporter');
            query.addWhere(['initiative_id = ?', initiative_id]);
            query.addWhere(['member_id = ?', req.current_member_id]);
            db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });

          });
          
        // upsert supporter
        } else {

          // check and lock privilege
          requireInitiativePrivilege(conn, req, res, initiative_id, function() {

            // check issue state
            requireIssueStateForInitiative(conn, req, res, initiative_id, ['admission', 'discussion', 'verification'], function() {

              // check if given draft is the current one
              var query = new selector.Selector('current_draft');
              query.addField('NULL');
              query.addWhere(['current_draft.initiative_id = ?', initiative_id]);
              query.addWhere(['current_draft.id = ?', draft_id]);
              
              db.query(conn, req, res, query, function(result) { 
                if (result.rows.length != 1) {
                  respond('json', conn, req, res, 'conflict', null, 'The draft with the supplied draft_id is not the current one anymore!');
                  return;
                }
                
                // upsert supporter
                var query = new selector.Upserter('supporter', ['initiative_id', 'member_id']);
                query.addValues({
                  initiative_id: initiative_id,
                  member_id: req.current_member_id,
                  draft_id: draft_id
                });

                db.query(conn, req, res, query, function(result) { 
                  respond('json', conn, req, res, 'ok');
                });

              });
            });
          });
        };
      });
    });
  },

  '/draft': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      var area_id = parseInt(params.area_id);
      var policy_id = parseInt(params.policy_id);
      var issue_id = parseInt(params.issue_id);
      var initiative_id = parseInt(params.initiative_id);
      var initiative_name = params.initiative_name;
      var initiative_discussion_url = params.initiative_discussion_url;
      var formatting_engine = params.formatting_engine;
      var content = params.content;

      if (!initiative_discussion_url) initiative_discussion_url = null;

      // check parameters
      if (!formatting_engine) {
          respond('json', conn, req, res, 'unprocessable', null, 'No formatting_engine supplied.');
          return;
      } else if (formatting_engine != 'rocketwiki' && formatting_engine != 'compat') {
          respond('json', conn, req, res, 'unprocessable', null, 'Invalid formatting engine supplied.');
          return;
      };

      if (!content) {
        respond('json', conn, req, res, 'unprocessable', null, 'No draft content supplied.');
        return;
      };

      lockMemberById(conn, req, res, req.current_member_id, function() {
        
        // new draft in new initiative in new issue
        if (area_id && !issue_id && !initiative_id) {

          // check parameters for new issue
          if (!policy_id) {
            respond('json', conn, req, res, 'unprocessable', null, 'No policy supplied.');
            return;
          }
          
          if (!initiative_name) {
            respond('json', conn, req, res, 'unprocessable', null, 'No initiative name supplied.');
            return;
          }
          
          requireAreaPrivilege(conn, req, res, area_id, function() {

            // check if policy is allowed in this area and if area and policy are active
            var query = new selector.Selector();
            query.from('allowed_policy');
            query.join('area', null, 'area.id = allowed_policy.area_id AND area.active');
            query.join('policy', null, 'policy.id = allowed_policy.policy_id AND policy.active');
            query.addField('NULL');
            query.addWhere(['area.id = ? AND policy.id = ?', area_id, policy_id]);
            db.query(conn, req, res, query, function (result, conn) {
              if (result.rows.length != 1) {
                respond('json', conn, req, res, 'unprocessable', null, 'Area and/or policy doesn\'t exist, area and/or policy is not active or policy is not allowed in this area.');
                return;
              };

              // check contingent
              requireContingentLeft(conn, req, res, true, function() {
                
                // insert new issue
                var query = new selector.SQLInsert('issue');
                query.addValues({
                  area_id: area_id,
                  policy_id: policy_id
                });
                query.addReturning('id');
                db.query(conn, req, res, query, function(result) {
                  var issue_id = result.rows[0].id;

                  // insert new initiative
                  var query = new selector.SQLInsert('initiative');
                  query.addValues({
                    issue_id: issue_id,
                    name: initiative_name,
                    discussion_url: initiative_discussion_url
                  });
                  query.addReturning('id');
                  db.query(conn, req, res, query, function(result) {
                    var initiative_id = result.rows[0].id;
                    
                    // insert initiator
                    var query = new selector.SQLInsert('initiator');
                    query.addValues({ initiative_id: initiative_id, member_id: req.current_member_id, accepted: true });
                    db.query(conn, req, res, query, function(result) {

                      // insert new draft
                      var query = new selector.SQLInsert('draft');
                      query.addValues({
                        initiative_id: initiative_id,
                        author_id: req.current_member_id,
                        formatting_engine: formatting_engine,
                        content: content 
                      });
                      query.addReturning('id');
                      db.query(conn, req, res, query, function (result, conn) {
                        var draft_id = result.rows[0].id;

                        respond('json', conn, req, res, 'ok', { issue_id: issue_id, initiative_id: initiative_id, draft_id: draft_id } );
                      });
                    });
                  });
                });
              });
            });
          });

        // new draft in new initiative in existant issue
        } else if (issue_id && !area_id && !initiative_id) {

          if (!initiative_name) {
            respond('json', conn, req, res, 'unprocessable', null, 'No initiative name supplied.');
            return;
          }
          
          // check privilege
          requireIssuePrivilege(conn, req, res, issue_id, function() {
            
            // check issue state
            requireIssueState(conn, req, res, issue_id, ['admission', 'discussion', 'verification'], function() {
            
              // check contingent
              requireContingentLeft(conn, req, res, true, function() {

                // insert initiative
                var query = new selector.SQLInsert('initiative');
                query.addValues({
                  issue_id: issue_id,
                  name: initiative_name,
                  discussion_url: initiative_discussion_url
                });
                query.addReturning('id');
                db.query(conn, req, res, query, function(result) {
                  var initiative_id = result.rows[0].id;
                  
                  // insert initiator
                  var query = new selector.SQLInsert('initiator');
                  query.addValues({
                    initiative_id: initiative_id,
                    member_id: req.current_member_id,
                    accepted: true
                  });
                  db.query(conn, req, res, query, function(result) {

                    // insert draft
                    var query = new selector.SQLInsert('draft');
                    query.addValues({
                      initiative_id: initiative_id,
                      author_id: req.current_member_id,
                      formatting_engine: formatting_engine,
                      content: content
                    });
                    query.addReturning('id');
                    db.query(conn, req, res, query, function (result, conn) {

                      var draft_id = result.rows[0].id;
                      respond('json', conn, req, res, 'ok', { initiative_id: initiative_id, draft_id: draft_id } );
                      
                    });
                  });
                });
              });
            });
          });

        // new draft in existant initiative
        } else if (initiative_id && !area_id && !issue_id ) {

          // check privilege
          requireInitiativePrivilege(conn, req, res, initiative_id, function() {
            
            // check issue state
            requireIssueStateForInitiative(conn, req, res, initiative_id, ['admission', 'discussion'], function() {
            

              // get initiator
              var query = new selector.Selector();
              query.from('initiator');
              query.addField('accepted');
              query.addWhere(['initiative_id = ? AND member_id = ?', initiative_id, req.current_member_id]);
              db.query(conn, req, res, query, function (result, conn) {

                // if member is not initiator, deny creating new draft
                if (result.rows.length != 1) {
                  respond('json', conn, req, res, 'forbidden', null, 'You are not initiator of this initiative and not allowed to update its draft.');
                  return;
                }
                var initiator = result.rows[0];
                if (!initiator.accepted) {
                  respond('json', conn, req, res, 'forbidden', null, 'You have been invited as initiator, but haven\'t accepted invitation and you are not allowed to update this initiative.');
                  return;
                };

                // check contingent
                requireContingentLeft(conn, req, res, false, function() {

                  // insert new draft
                  var query = new selector.SQLInsert('draft');
                  query.addValues({
                    initiative_id: initiative_id,
                    author_id: req.current_member_id,
                    formatting_engine: formatting_engine,
                    content: content
                  });
                  query.addReturning('id');
                  db.query(conn, req, res, query, function (result, conn) {

                    var draft_id = result.rows[0].id;
                    respond('json', conn, req, res, 'ok', { draft_id: draft_id } );
                  });
                });
              });
            });
          });

        // none of them (invalid request)
        } else {
          respond('json', conn, req, res, 'unprocessable', null, 'Excactly one of area_id, issue_id or initiative_id must be supplied!');
        };
        
      });
    });
  },

  '/suggestion': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      // TODO
    });
  },
  
  '/opinion': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      // TODO
    });
  },

  '/delegation': function (conn, req, res, params) {
    requireAccessLevel(conn, req, res, 'member', function() {
      var unit_id = parseInt(params.unit_id);
      var area_id = parseInt(params.area_id);
      var issue_id = parseInt(params.issue_id);
      var trustee_id;

      if (params.trustee_id == '') {
        trustee_id = null;
      } else {
        trustee_id = parseInt(params.trustee_id);
      }
      
      lockMemberById(conn, req, res, req.current_member_id, function() {
        
        if (params.delete) {
          var query = new selector.SQLDelete('delegation')
          if (unit_id && !area_id && !issue_id) {
            query.addWhere(['unit_id = ?', unit_id]);
          } else if (!unit_id && area_id && !issue_id) {
            query.addWhere(['area_id = ?', area_id]);
          } else if (!unit_id && !area_id && issue_id) {
            query.addWhere(['issue_id = ?', issue_id]);
          } else {
            respond('json', conn, req, res, 'unprocessable', null, 'Excactly one of unit, area_id, issue_id must be supplied!');
            return;
          } 
          query.addWhere(['truster_id = ?', req.current_member_id]);
          db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });
        } else {
          var query = new selector.Upserter('delegation', ['truster_id']);
          query.addValues({
            truster_id: req.current_member_id,
            trustee_id: trustee_id
          });
          if (unit_id && !area_id && !issue_id) {
            
            // check privilege
            requireUnitPrivilege(conn, req, res, unit_id, function() {

              query.addKeys(['unit_id'])
              query.addValues({ unit_id: unit_id, scope: 'unit' });
              db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });
            });
            
          } else if (!unit_id && area_id && !issue_id) {

            // check privilege
            requireAreaPrivilege(conn, req, res, area_id, function() {

              query.addKeys(['area_id'])
              query.addValues({ area_id: area_id, scope: 'area' });
              db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });
            });

          } else if (!unit_id && !area_id && issue_id) {

            // check privilege
            requireIssuePrivilege(conn, req, res, issue_id, function() {

              // check issue state
              requireIssueState(conn, req, res, issue_id, ['admission', 'discussion', 'verification', 'voting'], function() {
                
                query.addKeys(['issue_id'])
                query.addValues({ issue_id: issue_id, scope: 'issue' });
                db.query(conn, req, res, query, function(result) { respond('json', conn, req, res, 'ok'); });
              });
            });
          } else {
            respond('json', conn, req, res, 'unprocessable', null, 'Excactly one of unit_id, area_id, issue_id must be supplied!');
            return;
          } 
        }
        
      });
      
    });
  },

};
