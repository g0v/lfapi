// ==========================================================================
// configuration of lfapi
// --------------------------------------------------------------------------
// Please read this file carefully and adjust settings for your system
// --------------------------------------------------------------------------

// the interface address the service should bind to (0.0.0.0 for ALL)
exports.bind_address = '0.0.0.0';

// the port number the service should bind to (usually 80)
exports.bind_port = 25520;

// access level for not logged in users (may be 'full', 'pseudonym',
// 'anonymous', 'none' or 'devel')
// never set access level to 'devel' on a productive installation!
exports.public_access_level = 'full';

// connection string to access the LiquidFeedback Core database
exports.connectionString = 'pg://localhost/liquid_feedback';

// public base url (including trailing slash)
exports.public_url_path = 'http://lf.example.org/api/';

// mail server, email sender and subject settings
exports.mail = {
  smtp_host:           'localhost',
  smtp_port:           '25',
  smtp_ssl:            false,
  smtp_domain:         'localhost',
  //smtp_authentication: 'login',
  //smtp_username:       'username',
  //smtp_password:       'password',
  from:                'Sender name <senderaddress@example.org>',
  subject_prefix:      '[email subject prefix] '
};

exports.settings = {
  result_row_limit: { max: 1001, default: 101 }
}
