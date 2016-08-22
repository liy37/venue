'use strict';

angular.module('venueApp')
  .directive('commaList', function ($http) {
    return {
      templateUrl: 'components/commaList/commaList.html',
      restrict: 'EA',
      scope: {
        list: '=',
        ampersand: '=',
        display: '&?'
      },
      link: function (scope, element, attrs) {
      },
      controller: function ($scope, $element) {
        if (!$scope.display){
          $scope.displayElem = function(elem){
            return String(elem);
          }
        }
        else{
            $scope.displayElem = function(elem) {
              return $scope.display({element: elem});
          }
        }
      }
    };
  });