const express = require('express');
const { receiveGithubWebhook } = require('../controllers/githubWebhookController');

const router = express.Router();

router.post('/', express.raw({ type: 'application/json', limit: '10mb' }), receiveGithubWebhook);

module.exports = router;
