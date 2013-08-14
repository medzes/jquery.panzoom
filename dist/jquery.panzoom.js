/**
 * @license jquery.panzoom.js v1.4.3
 * Updated: Wed Aug 14 2013
 * Add pan and zoom functionality to any element
 * Copyright (c) 2013 timmy willison
 * Released under the MIT license
 * https://github.com/timmywil/jquery.panzoom/blob/master/MIT-License.txt
 */

(function( global, factory ) {
	// Define the plugin using AMD if present
	// Skips commonjs as this is not meant for that environment
	if ( typeof define === 'function' && define.amd ) {
		define([ 'jquery' ], factory );
	} else {
		factory( global.jQuery );
	}
}( this, function( $ ) {
	'use strict';

	// Lift touch properties using fixHooks
	var touchHook = {
		props: [ 'touches', 'pageX', 'pageY' ],
		/**
		 * Support: Android
		 * Android sets pageX/Y to 0 for any touch event
		 * Attach first touch's pageX/pageY if not set correctly
		 */
		filter: function( event, originalEvent ) {
			var touch;
			if ( !originalEvent.pageX && originalEvent.touches && (touch = originalEvent.touches[0]) ) {
				event.pageX = touch.pageX;
				event.pageY = touch.pageY;
			}
			return event;
		}
	};
	$.each([ 'touchstart', 'touchmove', 'touchend' ], function( i, name ) {
		$.event.fixHooks[ name ] = touchHook;
	});

	var datakey = '__pz__';
	var slice = Array.prototype.slice;
	var rupper = /([A-Z])/g;
	var rsvg = /^http:[\w\.\/]+svg$/;

	var floating = '(\\-?[\\d\\.e]+)';
	var commaSpace = '\\,?\\s*';
	var rmatrix = new RegExp(
		'^matrix\\(' +
		floating + commaSpace +
		floating + commaSpace +
		floating + commaSpace +
		floating + commaSpace +
		floating + commaSpace +
		floating + '\\)$'
	);

	/**
	 * Creates the options object for reset functions
	 * @param {Boolean|Object} opts See reset methods
	 * @returns {Object} Returns the newly-created options object
	 */
	function createResetOptions( opts ) {
		var options = { range: true, animate: true };
		if ( typeof opts === 'boolean' ) {
			options.animate = opts;
		} else {
			$.extend( options, opts );
		}
		return options;
	}

	/**
	 * Create a Panzoom object for a given element
	 * @constructor
	 * @param {Element} elem - Element to use pan and zoom
	 * @param {Object} [options] - An object literal containing options to override default options
	 *  (See Panzoom.defaults for ones not listed below)
	 * @param {jQuery} [options.$zoomIn] - zoom in buttons/links collection (you can also bind these yourself
	 *  e.g. $button.on('click', function( e ) { e.preventDefault(); $elem.panzooom('zoomIn'); }); )
	 * @param {jQuery} [options.$zoomOut] - zoom out buttons/links collection on which to bind zoomOut
	 * @param {jQuery} [options.$zoomRange] - zoom in/out with this range control
	 * @param {jQuery} [options.$reset] - Reset buttons/links collection on which to bind the reset method
	 * @param {Function} [options.on[Start|Change|Zoom|Pan|End|Reset] - Optional callbacks for panzoom events
	 */
	var Panzoom = function( elem, options ) {

		// Sanity checks
		if ( elem.nodeType !== 1 ) {
			$.error('Panzoom called on non-Element node');
		}
		if ( !$.contains(document, elem) ) {
			$.error('Panzoom element must be attached to the document');
		}

		// Don't remake
		var d = $.data( elem, datakey );
		if ( d ) {
			return d;
		}

		// Allow instantiation without `new` keyword
		if ( !(this instanceof Panzoom) ) {
			return new Panzoom( elem, options );
		}

		// Extend default with given object literal
		// Each instance gets its own options
		this.options = options = $.extend( {}, Panzoom.defaults, options );
		this.elem = elem;
		var $elem = this.$elem = $(elem);
		this.$parent = $elem.parent();

		// This is SVG if the namespace is SVG
		// However, while <svg> elements are SVG, we want to treat those like other elements
		this.isSVG = rsvg.test( elem.namespaceURI ) && elem.nodeName.toLowerCase() !== 'svg';

		this.panning = false;

		// Save the original transform value
		// Save the prefixed transform style key
		// Set the starting transform
		$elem.css('transform', this._buildTransform());
		// Build the appropriately-prefixed transform style property name
		// De-camelcase
		this._transform = $.cssProps.transform.replace( rupper, '-$1' ).toLowerCase();
		// Build the transition value
		this._buildTransition();

		// Build dimensions for containment
		this._buildContain();

		// Add zoom and reset buttons to `this`
		var $empty = $();
		var self = this;
		$.each([ '$zoomIn', '$zoomOut', '$zoomRange', '$reset' ], function( i, name ) {
			self[ name ] = options[ name ] || $empty;
		});

		this.enable();

		// Save the instance
		$.data( elem, datakey, this );
	};

	// Attach regex for possible use (immutable)
	Panzoom.rmatrix = rmatrix;

	Panzoom.defaults = {
		// Should always be non-empty
		// Used to bind jQuery events without collisions
		// A guid is not added here as different instantiations/versions of panzoom
		// on the same element is not supported, so don't do it.
		eventNamespace: '.panzoom',

		// Whether or not to transition the scale
		transition: true,

		// Default cursor style for the element
		cursor: 'move',

		// There may be some use cases for zooming without panning or vice versa
		disablePan: false,
		disableZoom: false,

		// The increment at which to zoom
		// adds/subtracts to the scale each time zoomIn/Out is called
		increment: 0.3,

		minScale: 0.4,
		maxScale: 5,

		// Animation duration (ms)
		duration: 200,
		// CSS easing used for scale transition
		easing: 'ease-in-out',

		// Indicate that the element should be contained within it's parent when panning
		// Note: this does not affect zooming outside of the parent
		// Set this value to 'invert' to only allow panning outside of the parent element (basically the opposite of the normal use of contain)
		// 'invert' is useful for a large panzoom element where you don't want to show anything behind it
		contain: false
	};

	Panzoom.prototype = {
		constructor: Panzoom,

		/**
		 * @returns {Panzoom} Returns the instance
		 */
		instance: function() {
			return this;
		},

		/**
		 * Enable or re-enable the panzoom instance
		 */
		enable: function() {
			// Unbind first
			this._initStyle();
			this._bind();
			this.disabled = false;
		},

		/**
		 * Disable panzoom
		 */
		disable: function() {
			this.disabled = true;
			this._resetStyle();
			this._unbind();
		},

		/**
		 * @returns {Boolean} Returns whether the current panzoom instance is disabled
		 */
		isDisabled: function() {
			return this.disabled;
		},

		/**
		 * Destroy the panzoom instance
		 */
		destroy: function() {
			this.disable();
			$.removeData( this.elem, datakey );
		},

		/**
		 * Return the element to it's original transform matrix
		 * @param {Boolean} [options] If a boolean is passed, animate the reset (default: true). If an options object is passed, simply pass that along to setMatrix.
		 * @param {Boolean} [options.silent] Silence the reset event
		 */
		reset: function( options ) {
			options = createResetOptions( options );
			// Reset the transform to its original value
			var matrix = this.setMatrix( this._origTransform, options );
			if ( !options.silent ) {
				this._trigger( 'reset', matrix );
			}
		},

		/**
		 * Only resets zoom level
		 * @param {Boolean|Object} [options] Whether to animate the reset (default: true) or an object of options to pass to zoom()
		 */
		resetZoom: function( options ) {
			options = createResetOptions( options );
			var origMatrix = this.getMatrix( this._origTransform );
			options.dValue = origMatrix[ 3 ];
			this.zoom( origMatrix[0], options );
		},

		/**
		 * Only reset panning
		 * @param {Boolean|Object} [options] Whether to animate the reset (default: true) or an object of options to pass to pan()
		 */
		resetPan: function( options ) {
			var origMatrix = this.getMatrix( this._origTransform );
			this.pan( origMatrix[4], origMatrix[5], createResetOptions(options) );
		},

		/**
		 * Retrieving the transform is different for SVG (unless a style transform is already present)
		 * @param {String} [transform] Pass in an transform value (like 'scale(1.1)') to have it formatted into matrix format for use by Panzoom
		 * @returns {String} Returns the current transform value of the element
		 */
		getTransform: function( transform ) {
			var elem = this.elem;
			if ( transform ) {
				// Set the passed in value
				$.style( elem, 'transform', transform );
			} else {
				// Use style rather than computed
				// If currently transitioning, computed transform might be unchanged
				transform = $.style( elem, 'transform' );
			}

			// SVG falls back to the transform attribute
			if ( this.isSVG && !transform ) {
				transform = $.attr( elem, 'transform' );
			// Convert any transforms set by the user to matrix format
			// by setting to computed
			} else if ( transform !== 'none' && !rmatrix.test(transform) ) {
				// Get computed
				transform = $.css( elem, 'transform' );
				// Set for next time
				$.style( elem, 'transform', transform );
			}

			return transform || 'none';
		},

		/**
		 * Retrieve the current transform matrix for $elem (or turn a transform into it's array values)
		 * @param {String} [transform] matrix-formatted transform value
		 * @returns {Array} Returns the current transform matrix split up into it's parts, or a default matrix
		 */
		getMatrix: function( transform ) {
			var matrix = rmatrix.exec( transform || this.getTransform() );
			if ( matrix ) {
				matrix.shift();
			}
			return matrix || [ 1, 0, 0, 1, 0, 0 ];
		},

		/**
		 * Given a matrix object, quickly set the current matrix of the element
		 * @param {Array|String} matrix
		 * @param {Boolean} [animate] Whether to animate the transform change
		 * @param {Object} [options]
		 * @param {Boolean|String} [options.animate] Whether to animate the transform change, or 'skip' indicating that it is unnecessary to set
		 * @param {Boolean} [options.contain] Override the global contain option
		 * @param {Boolean} [options.range] If true, $zoomRange's value will be updated.
		 * @param {Boolean} [options.silent] If true, the change event will not be triggered
		 * @returns {Array} Returns the newly-set matrix
		 */
		setMatrix: function( matrix, options ) {
			if ( this.disabled ) { return; }
			if ( !options ) { options = {}; }
			// Convert to array
			if ( typeof matrix === 'string' ) {
				matrix = this.getMatrix( matrix );
			}
			var dims, container, marginW, marginH;
			var scale = +matrix[0];
			var contain = typeof options.contain !== 'undefined' ? options.contain : this.options.contain;

			// Apply containment
			if ( contain ) {
				dims = this._checkDims();
				container = this.container;
				marginW = ((dims.width * scale) - container.width) / 2;
				marginH = ((dims.height * scale) - container.height) / 2;
				if ( contain === 'invert' ) {
					marginW += ((container.width - dims.width) / 2);
					marginH += ((container.height - dims.height) / 2);
					matrix[4] = Math.max( Math.min( matrix[4], marginW - dims.left ), -marginW - dims.left );
					matrix[5] = Math.max( Math.min( matrix[5], marginH - dims.top ), -marginH - dims.top );
				} else {
					matrix[4] = Math.min( Math.max( matrix[4], marginW - dims.left ), -marginW - dims.left );
					matrix[5] = Math.min( Math.max( matrix[5], marginH - dims.top ), -marginH - dims.top );
				}
			}
			if ( options.animate !== 'skip' ) {
				// Set transition
				this.transition( !options.animate );
			}
			// Update range
			if ( options.range ) {
				this.$zoomRange.val( scale );
			}
			$[ this.isSVG ? 'attr' : 'style' ]( this.elem, 'transform', 'matrix(' + matrix.join(',') + ')' );
			if ( !options.silent ) {
				this._trigger( 'change', matrix );
			}

			return matrix;
		},

		/**
		 * @returns {Boolean} Returns whether the panzoom element is currently being dragged
		 */
		isPanning: function() {
			return this.panning;
		},

		/**
		 * Apply the current transition to the element, if allowed
		 * @param {Boolean} [off] Indicates that the transition should be turned off
		 */
		transition: function( off ) {
			var transition = off || !this.options.transition ? 'none' : this._transition;
			$.style( this.elem, 'transition', transition );
		},

		/**
		 * Pan the element to the specified translation X and Y
		 * Note: this is not the same as setting jQuery#offset() or jQuery#position()
		 * @param {Number} x
		 * @param {Number} y
		 * @param {Object} [options] These options are passed along to setMatrix
		 * @param {Array} [options.matrix] The matrix being manipulated (if already known so it doesn't have to be retrieved again)
		 * @param {Boolean} [options.silent] Silence the pan event. Note that this will also silence the setMatrix change event.
		 * @param {Boolean} [options.relative] Make the x and y values relative to the existing matrix
		 */
		pan: function( x, y, options ) {
			if ( !options ) { options = {}; }
			var matrix = options.matrix;
			if ( !matrix ) {
				matrix = this.getMatrix();
			}
			// Cast existing matrix values to numbers
			if ( options.relative ) {
				matrix[4] = +matrix[4] + x;
				matrix[5] = +matrix[5] + y;
			} else {
				matrix[4] = x;
				matrix[5] = y;
			}
			this.setMatrix( matrix, options );
			if ( !options.silent ) {
				this._trigger( 'pan', x, y );
			}
		},

		/**
		 * Zoom in/out the element using the scale properties of a transform matrix
		 * @param {Number|Boolean} [scale] The scale to which to zoom or a boolean indicating to transition a zoom out
		 * @param {Object} [opts]
		 * @param {Boolean} [opts.noSetRange] Specify that the method should not set the $zoomRange value (as is the case when $zoomRange is calling zoom on change)
		 * @param {Object} [opts.middle] Specify a middle point towards which to gravitate when zooming
		 * @param {Boolean} [opts.animate] Whether to animate the zoom (defaults to true if scale is not a number, false otherwise)
		 * @param {Boolean} [opts.silent] Silence the zoom event
		 * @param {Array} [opts.matrix] Optionally pass the current matrix so it doesn't need to be retrieved
		 * @param {Number} [opts.dValue] Think of a transform matrix as four values a, b, c, d (where a/d are the horizontal/vertical scale values and b/c are the skew values) (5 and 6 of matrix array are the tx/ty transform values).
		 *  Normally, the scale is set to both the a and d values of the matrix.
		 *  This option allows you to specify a different d value for the zoom. For instance, to flip vertically, you could set -1 as the dValue.
		 * @returns {Array} Returns the newly-set matrix
		 */
		zoom: function( scale, opts ) {
			var animate = false;
			var options = this.options;
			if ( options.disableZoom && options.disablePan ) { return; }
			// Shuffle arguments
			if ( typeof scale === 'object' ) {
				opts = scale;
				scale = null;
			} else if ( !opts ) {
				opts = {};
			}
			var matrix = opts.matrix || this.getMatrix();

			if ( !options.disableZoom ) {
				// Set the middle point
				var middle = opts.middle;
				if ( middle ) {
					matrix[4] = +matrix[4] + (middle.pageX === matrix[4] ? 0 : middle.pageX > matrix[4] ? 1 : -1);
					matrix[5] = +matrix[5] + (middle.pageY === matrix[5] ? 0 : middle.pageY > matrix[5] ? 1 : -1);
				}

				// Calculate zoom based on increment
				if ( typeof scale !== 'number' ) {
					scale = +matrix[0] + (options.increment * (scale ? -1 : 1));
					animate = true;
				}

				// Constrain scale
				if ( scale > options.maxScale ) {
					scale = options.maxScale;
				} else if ( scale < options.minScale ) {
					scale = options.minScale;
				}

				// Set the scale
				matrix[0] = scale;
				matrix[3] = typeof opts.dValue === 'number' ? opts.dValue : scale;
			}

			// Calling zoom may still pan the element
			this.setMatrix( matrix, {
				animate: typeof opts.animate === 'boolean' ? opts.animate : animate,
				// Set the zoomRange value
				range: !opts.noSetRange
			});

			// Trigger zoom event
			if ( !opts.silent && !options.disableZoom ) {
				this._trigger( 'zoom', scale, opts );
			}
		},

		/**
		 * Get/set option on an existing instance
		 * @returns {Array|undefined} If getting, returns an array of all values
		 *   on each instance for a given key. If setting, continue chaining by returning undefined.
		 */
		option: function( key, value ) {
			var options;
			if ( !key ) {
				// Avoids returning direct reference
				return $.extend( {}, this.options );
			}

			if ( typeof key === 'string' ) {
				if ( arguments.length === 1 ) {
					return this.options[ key ];
				}
				options = {};
				options[ key ] = value;
			} else {
				options = key;
			}

			this._setOptions( options );
		},

		/**
		 * Internally sets options
		 * @param {Object} options - An object literal of options to set
		 */
		_setOptions: function( options ) {
			var self = this;
			$.each( options, function( key, value ) {
				switch( key ) {
					case 'disablePan':
						self._resetStyle();
						/* falls through */
					case 'disableZoom':
					case '$zoomIn':
					case '$zoomOut':
					case '$zoomRange':
					case '$reset':
					case 'onStart':
					case 'onChange':
					case 'onZoom':
					case 'onPan':
					case 'onEnd':
					case 'onReset':
					case 'eventNamespace':
						self._unbind();
				}
				self.options[ key ] = value;
				switch( key ) {
					case 'disablePan':
						self._initStyle();
						/* falls through */
					case 'disableZoom':
					case '$zoomIn':
					case '$zoomOut':
					case '$zoomRange':
					case '$reset':
					case 'onStart':
					case 'onChange':
					case 'onZoom':
					case 'onPan':
					case 'onEnd':
					case 'onReset':
					case 'eventNamespace':
						self._bind();
						break;
					case 'cursor':
						$.style( self.elem, 'cursor', value );
						break;
					case 'minScale':
						self.$zoomRange.attr( 'min', value );
						break;
					case 'maxScale':
						self.$zoomRange.attr( 'max', value );
						break;
					case 'startTransform':
						self._buildTransform();
						break;
					case 'duration':
					case 'easing':
						self._buildTransition();
						/* falls through */
					case 'transition':
						self.transition();
				}
			});
		},

		/**
		 * Initialize base styles for the element and its parent
		 */
		_initStyle: function() {
			// Set elem styles
			if ( !this.options.disablePan ) {
				this.$elem.css( 'cursor', this.options.cursor );
			}

			// Set parent to relative if set to static
			var $parent = this.$parent;
			// No need to add styles to the body
			if ( $parent.length && !$.nodeName($parent[0], 'body') ) {
				var parentStyles = {
					overflow: 'hidden'
				};
				if ( $parent.css('position') === 'static' ) {
					parentStyles.position = 'relative';
				}
				$parent.css( parentStyles );
			}
		},

		/**
		 * Undo any styles attached in this plugin
		 */
		_resetStyle: function() {
			this.$elem.css({
				'cursor': '',
				'transition': ''
			});
			this.$parent.css({
				'overflow': '',
				'position': ''
			});
		},

		/**
		 * Binds all necessary events
		 */
		_bind: function() {
			var self = this;
			var options = this.options;
			var ns = options.eventNamespace;
			var str_start = 'touchstart' + ns + ' mousedown' + ns;
			var str_click = 'touchend' + ns + ' click' + ns;
			var events = {};
			var $reset = this.$reset;

			// Bind panzoom events from options
			$.each([ 'Start', 'Change', 'Zoom', 'Pan', 'End', 'Reset' ], function() {
				var m = options[ 'on' + this ];
				if ( $.isFunction(m) ) {
					events[ 'panzoom' + this.toLowerCase() + ns ] = m;
				}
			});

			// Bind $elem drag and click/touchdown events
			// Bind touchstart if either panning or zooming is enabled
			if ( !options.disablePan || !options.disableZoom ) {
				events[ str_start ] = function( e ) {
					var touches;
					if ( e.type === 'mousedown' ?
						// Ignore right click when handling a click
						!options.disablePan && e.which === 1 :
						// Touch
						(touches = e.touches) && ((touches.length === 1 && !options.disablePan) || touches.length === 2) ) {

						e.preventDefault();
						e.stopPropagation();
						self._startMove( e, touches );
					}
				};
			}
			this.$elem.on( events );

			// Bind reset
			if ( $reset.length ) {
				$reset.on( str_click, function( e ) { e.preventDefault(); self.reset(); });
			}

			// No bindings if zooming is disabled
			if ( options.disableZoom ) {
				return;
			}

			var $zoomIn = this.$zoomIn;
			var $zoomOut = this.$zoomOut;
			var $zoomRange = this.$zoomRange;

			// Bind zoom in/out
			// Don't bind one without the other
			if ( $zoomIn.length && $zoomOut.length ) {
				// preventDefault cancels future mouse events on touch events
				$zoomIn.on( str_click, function( e ) { e.preventDefault(); self.zoom(); });
				$zoomOut.on( str_click, function( e ) { e.preventDefault(); self.zoom( true ); });
			}

			if ( $zoomRange.length ) {
				// Set default attributes
				$zoomRange.attr({
					min: options.minScale,
					max: options.maxScale,
					step: 0.05
				}).prop({
					value: this.getMatrix()[0]
				});
				events = {};
				// Cannot prevent default action here, just use mousedown event
				events.mousedown = function() {
					self.transition( true );
				};
				events[ 'change' + ns ] = function() {
					self.zoom( +this.value, { noSetRange: true } );
				};
				$zoomRange.on( events );
			}
		},

		/**
		 * Unbind all events
		 */
		_unbind: function() {
			this.$elem
				.add( this.$zoomIn )
				.add( this.$zoomOut )
				.add( this.$reset )
				.off( this.options.eventNamespace );
		},

		/**
		 * Builds the original transform value
		 */
		_buildTransform: function() {
			// Save the original transform
			// Retrieving this also adds the correct prefixed style name
			// to jQuery's internal $.cssProps
			return this._origTransform = this.getTransform( this.options.startTransform );
		},

		/**
		 * Set transition property for later use when zooming
		 * If SVG, create necessary animations elements for translations and scaling
		 */
		_buildTransition: function() {
			var options = this.options;
			if ( this._transform ) {
				this._transition = this._transform + ' ' + options.duration + 'ms ' + options.easing;
			}
		},

		/**
		 * Builds the restricing dimensions from the containment element
		 */
		_buildContain: function() {
			// Reset container properties
			var $parent = this.$parent;
			this.container = {
				width: $parent.width(),
				height: $parent.height()
			};
			var elem = this.elem;
			var $elem = this.$elem;
			this.dimensions = this.isSVG ? {
				left: elem.getAttribute('x') || 0,
				top: elem.getAttribute('y') || 0,
				width: elem.getAttribute('width') || $elem.width(),
				height: elem.getAttribute('height') || $elem.height()
			} : {
				left: $.css( elem, 'left', true ) || 0,
				top: $.css( elem, 'top', true ) || 0,
				width: $elem.width(),
				height: $elem.height()
			};
		},

		/**
		 * Checks dimensions to make sure they don't need to be re-calculated
		 */
		_checkDims: function() {
			var dims = this.dimensions;
			// Rebuild if width or height is still 0
			if ( !dims.width || !dims.height ) {
				this._buildContain();
			}
			return this.dimensions;
		},

		/**
		 * Calculates the distance between two touch points
		 * Remember pythagorean?
		 * @param {Array} touches
		 * @returns {Number} Returns the distance
		 */
		_getDistance: function( touches ) {
			var touch1 = touches[0];
			var touch2 = touches[1];
			return Math.sqrt( Math.pow(Math.abs( touch2.pageX - touch1.pageX ), 2) + Math.pow(Math.abs( touch2.pageY - touch1.pageY ), 2) );
		},

		/**
		 * Constructs an approximated point in the middle of two touch points
		 * @returns {Object} Returns an object containing pageX and pageY
		 */
		_getMiddle: function( touches ) {
			var touch1 = touches[0];
			var touch2 = touches[1];
			return {
				pageX: ((touch2.pageX - touch1.pageX) / 2) + touch1.pageX,
				pageY: ((touch2.pageY - touch1.pageY) / 2) + touch1.pageY
			};
		},

		/**
		 * Trigger a panzoom event on our element
		 * The event is passed the Panzoom instance
		 * @param {String} name
		 * @param {Mixed} arg1[, arg2, arg3, ...] Arguments to append to the trigger
		 */
		_trigger: function ( name ) {
			this.$elem.triggerHandler( 'panzoom' + name, [this].concat(slice.call( arguments, 1 )) );
		},

		/**
		 * Starts the pan
		 * This is bound to mouse/touchmove on the element
		 * @param {jQuery.Event} event An event with pageX, pageY, and possibly the touches list
		 * @param {TouchList} [touches] The touches list if present
		 */
		_startMove: function( event, touches ) {
			var move,
				startDistance, startScale, startMiddle,
				startPageX, startPageY;
			var self = this;
			var options = this.options;
			var isTouch = event.type === 'touchstart';
			var ns = options.eventNamespace;
			var moveEvent = (isTouch ? 'touchmove' : 'mousemove') + ns;
			var endEvent = (isTouch ? 'touchend' : 'mouseup') + ns;
			var matrix = this.getMatrix();
			var original = matrix.slice( 0 );
			var origPageX = +original[4];
			var origPageY = +original[5];

			// Remove any transitions happening
			this.transition( true );

			// Indicate that we are currently panning
			this.panning = true;

			// Trigger start event
			this._trigger( 'start', event, touches );

			if ( touches && touches.length === 2 ) {
				startDistance = this._getDistance( touches );
				startScale = +matrix[0];
				startMiddle = this._getMiddle( touches );
				move = function( e ) {
					e.preventDefault();

					// Calculate move on middle point
					var middle = self._getMiddle( touches = e.touches );

					if ( !options.disablePan ) {
						matrix[4] = origPageX + middle.pageX - startMiddle.pageX;
						matrix[5] = origPageY + middle.pageY - startMiddle.pageY;
					}

					// Set zoom
					var diff = self._getDistance( touches ) - startDistance;
					self.zoom( diff / 300 + startScale, { middle: middle, matrix: matrix } );

					// Trigger the pan event for the move (which was done when calling zoom)
					if ( !options.disablePan ) {
						self._trigger( 'pan', matrix[4], matrix[5] );
					}
				};
			} else {
				startPageX = event.pageX;
				startPageY = event.pageY;

				/**
				 * Mousemove/touchmove function to pan the element
				 * @param {Object} e Event object
				 */
				move = function( e ) {
					e.preventDefault();
					self.pan(
						origPageX + e.pageX - startPageX,
						origPageY + e.pageY - startPageY,
						{ matrix: matrix, animate: 'skip' }
					);
				};
			}

			// Bind the handlers
			$(document)
				.off( ns )
				.on( moveEvent, move )
				.on( endEvent, function( e ) {
					e.preventDefault();
					$(this).off( ns );
					self.panning = false;
					// Trigger our end event
					// jQuery's not is used here to compare Array equality
					self._trigger( 'end', matrix, !!$(original).not(matrix).length );
				});
		}
	};

	/**
	 * Extend jQuery
	 * @param {Object|String} options - The name of a method to call on the prototype
	 *  or an object literal of options
	 * @returns {jQuery|Mixed} jQuery instance for regular chaining or the return value(s) of a panzoom method call
	 */
	$.fn.panzoom = function( options ) {
		var instance, args, m, ret;

		// Call methods widget-style
		if ( typeof options === 'string' ) {
			ret = [];
			args = slice.call( arguments, 1 );
			this.each(function() {
				instance = $.data( this, datakey );

				if ( !instance ) {
					ret.push( undefined );

				// Ignore methods beginning with `_`
				} else if ( options.charAt(0) !== '_' &&
					typeof (m = instance[ options ]) === 'function' &&
					// If nothing is returned, do not add to return values
					(m = m.apply( instance, args )) !== undefined ) {

					ret.push( m );
				}
			});

			// Return an array of values for the jQuery instances
			// Or the value itself if there is only one
			// Or keep chaining
			return ret.length ?
				(ret.length === 1 ? ret[0] : ret) :
				this;
		}

		return this.each(function() { new Panzoom( this, options ); });
	};

	return Panzoom;
}));
