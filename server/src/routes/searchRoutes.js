const express = require('express');
const protect = require('../middleware/authMiddleware');
const { search } = require('../controllers/searchController');

const router = express.Router();

router.get('/search', protect, search);

module.exports = router;