'use strict';

/** Every case, in run order. Later files use what earlier ones leave in `state`. */
module.exports = [
  ...require('./00-preflight'),
  ...require('./01-auth'),
  ...require('./02-profile'),
  ...require('./03-listings'),
  ...require('./04-listing-publishing'),
  ...require('./05-engagement'),
  ...require('./06-discovery'),
  ...require('./07-social'),
  ...require('./08-chat-setup'),
  ...require('./09-chat-messages'),
  ...require('./10-calls'),
  ...require('./11-notifications'),
  ...require('./12-payments'),
  ...require('./13-account'),
  ...require('./99-end'),
];
