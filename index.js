module.exports = function (app) {
  const plugin = {
    id: 'signalk-database',
    name: 'SignalK Database',
    description: 'Database / persistence plugin for SignalK (skeleton).',
    schema: {
      type: 'object',
      properties: {}
    },
    start: function (_options) {
      app.debug('signalk-database start (skeleton — no persistence implemented)');
    },
    stop: function () {
      app.debug('signalk-database stop');
    }
  };

  return plugin;
};
