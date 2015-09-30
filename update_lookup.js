


window._currentApp = false;
window._selectedApp = false;

$(document).bind("javascriptClassesLoaded", function() {
    if (typeof(Sideview)!="undefined") {    
        
        
        Sideview.utils.declareCustomBehavior("changeCurrentApp", function(customBehaviorModule) {
            customBehaviorModule.onContextChange = function() {
                var context = this.getContext();
                var app = context.get("app.rawValue") || window._selectedApp;
                window._selectedApp = app;

                if (!window._currentApp) {
                    window._currentApp = $(document.body).attr("s:app");
                }
                $(document.body).attr("s:app",app);
            }
        });

        Sideview.utils.declareCustomBehavior("changeCurrentAppBack", function(customBehaviorModule) {
            customBehaviorModule.onContextChange = function() {
                if (window._currentApp) {  
                    $(document.body).attr("s:app",window._currentApp);
                    window._currentApp = false;
                } 
            }
        });

        Sideview.utils.declareCustomBehavior("receivePushesForRowUpdates", function(searchModule) {
            if (window.__rowUpdater) {
                console.error("receivePushesForRowUpdates - hees already got one");
            }
            window.__rowUpdater = searchModule;
        });

        Sideview.utils.declareCustomBehavior("receivePushesForRowDeletes", function(searchModule) {
            if (window.__rowDeleter) {
                console.error("receivePushesForRowDeletes - hees already got one");
            }
            window.__rowDeleter = searchModule;
        });

        Sideview.utils.declareCustomBehavior("hookForReloadingLookup", function(module) {
            if (window.__reloader) {
                console.error("hookForReloadingLookup - hees already got one");
            }
            window.__reloader = module;
            module.getModifiedContext = function() {
                var context = this.getContext();
                if (window.__pageOffset) {
                    context.set("results.offset",window.__pageOffset);
                }
                return context;
            }
        });
            
        Sideview.utils.declareCustomBehavior("reloadEditedLookup", function(customBehaviorModule) {
            customBehaviorModule.onContextChange = function() {
                window.__reloader.pushContextToChildren();
            }
        });
        
        Sideview.utils.declareCustomBehavior("pushAppAndLookupName", function(customBehaviorModule) {
            customBehaviorModule.onContextChange = function() {
                var context = this.getContext();
                var form = document.forms["lookupUpdater"];
                $(form.lookupName).val(context.get("lookupName.rawValue"));
                
                // these are just so we know what app and view we're at,  to 
                // redirect back to the right one after. 
                // obviously it'll be sideview_utils/update_lookup often, but 
                // not for OEM's. 
                $(form.currentApp).val(Sideview.utils.getCurrentApp());
                $(form.currentView).val(Sideview.utils.getCurrentView());
                
                $(form.app).val(context.get("app.rawValue"));
                $(form.splunk_form_key).val(Sideview.utils.getConfigValue("FORM_KEY"));
            }
        });

        Sideview.utils.declareCustomBehavior("addNewRow", function(customBehaviorModule) {
            customBehaviorModule.getModifiedContext = function(evt) {
                var context = this.getContext();
                
                var values = {};
                $("div.addNewRow input").each(function() {
                    var key = $(this).attr("name");
                    values[key] = $(this).val();
                });
                var lookupName = context.get("lookupName.rawValue");
                var s = [];
                s.push("| inputlookup " + lookupName);
                s.push("| append [ | stats count | fields - count")
                for (key in values) {
                    if (values.hasOwnProperty(key) && values[key]!="") {
                        s.push('| eval ' + key + '="' + values[key] + '"');
                    }
                }
                s.push("]");
                s.push("| outputlookup " + lookupName);
                search = new Splunk.Search(s.join(""));
                context.set("search",search);
                   
                return context;
            };
        });

        Sideview.utils.declareCustomBehavior("neverReload", function(htmlModule) {
            htmlModule.onContextChange = function(){}
        });

        Sideview.utils.declareCustomBehavior("editableTable", function(tableModule) {
            tableModule.hasUncommittedChanges = function(row) {
                var retVal=false;
                row.find("input").each(function() {
                    var oldValue = $(this).attr("s:oldValue") || "";
                    if (oldValue != $(this).val()) {
                        retVal=true;
                        return false
                    }
                });
                return retVal;
            }
            tableModule.renderDataCell = function(tr, field, value) {
                var tableModule = this;
                var td = $("<td>");
                var input = $("<input>")
                    .attr("s:field",field)
                    .keyup(function(e) {
                        var me = $(this);
                        var row = $(me.parents("tr")[0]);
                        var button = $(me.parents("tr")[0]).find("button.update");
                        
                        if (tableModule.hasUncommittedChanges(row)) {
                            button.removeClass("splButton-secondary");
                            button.addClass("splButton-primary");                        
                        } 
                        else {
                            button.removeClass("splButton-primary");
                            button.addClass("splButton-secondary");
                        }
                        var code = e.which;
                        if(code==13) {
                            button.click();
                        }
                    });
                    
                if (value) {
                    input.val(value).attr("s:oldValue",value);
                }
                td.append(input);
                tr.append(td);
            }
            
            tableModule.getBaseMatchingSearch = function(lookupName,oldValueDict) {
                var s = [];
                s.push("| inputlookup " + lookupName);
                s.push("| eval zomgItsOurRow=if(");
                var condi = [];
                for (key in oldValueDict) {
                    if (oldValueDict.hasOwnProperty(key)) {    
                        if (!oldValueDict[key] ) {
                            condi.push("(" + key + '=="' + oldValueDict[key] + '" OR isnull(' + key + '))');
                        }
                        // splunk has irritating habit of returning time with subseconds even if _subseconds is null.
                        else if (key=="_time") {
                            condi.push(key + '==round(tonumber("' + oldValueDict[key] + '"))');
                        } else {
                            condi.push(key + '=="' + oldValueDict[key] + '"');
                        }
                    }
                }
                s.push(condi.join(" AND "));
                s.push(',"1","0")');
                // now the problem is,  that if you have dupes on page 3 and page 5, 
                // and the user edits the page 5 dupe, the page 3 record is updated. 
                // we can potentially pass row number and use that as an additional criterion
                // for the base match?
                s.push('| streamstats count(eval(zomgItsOurRow==1)) as zomgHaveWeMatchedYet');
                s.push('| eval zomgItsOurRow=if(zomgHaveWeMatchedYet<2,zomgItsOurRow,0)');
                s.push('| fields - zomgHaveWeMatchedYet');
                return s;
            }

            /** 
             * uses these 2 dicts to create a big search string that does
             * | inputlookup
             * | eval zomgItsOurRow=if (every old value is the same)
             * | eval field1=if(zomgItsOurRow,newField1,field1)
             * | eval field2=if(zomgItsOurRow,newField1,field1)
             *   ...
             * | fields - zomgItsOurRow 
             * | outputlookup
             */
            tableModule.getRowUpdateSearch = function(lookupName,oldValueDict,newValueDict) {
                var s = this.getBaseMatchingSearch(lookupName, oldValueDict);
                
                var fields = [];
                var evalStatements = []
                for (key in newValueDict) {
                    if (newValueDict.hasOwnProperty(key)) {
                        fields.push(key);
                        evalStatements.push('eval ' + key + '=if(zomgItsOurRow=="1","' + newValueDict[key] + '",' + key + ')')
                    }
                }
                s.push(" | " + evalStatements.join(" | "));
                //s.push(" | streamstats count as zomgItsTheDuplicateCount by " + fields.join(" "));
                //s.push(" | where zomgItsTheDuplicateCount==1");
                s.push(" | fields - zomgItsOurRow");
                s.push(" | outputlookup " + lookupName);
                return s.join("");
            }
            
            tableModule.getRowDeleteSearch = function(lookupName,oldValueDict) {
                var s = this.getBaseMatchingSearch(lookupName, oldValueDict);
                s.push("| search NOT zomgItsOurRow=1");
                s.push(" | fields - zomgItsOurRow ");    
                s.push(" | outputlookup " + lookupName);
                return s.join("");
            }
            tableModule.getHiddenFields = function() {
                return {};
            }
			
			tableModule.getRowUpdateAllFilter = function( oldValueDict) {
                var s = [];
				s.push("| search NOT (");
                //s.push("| eval zomgItsOurRow=if(");
                var condi = [];
                for (key in oldValueDict) {
                            condi.push("(" + key + '="' + oldValueDict[key] + '")' );
                }
                s.push(condi.join(" AND ") + ") ");
				return s.join("");
            }
			
			tableModule.getRowUpdateAllAppend = function(newValueDict) {
                var s = [];
				s.push("| append [| inputlookup app_thresholds.csv | head 1 | fields - *");
                //s.push("| eval zomgItsOurRow=if(");
                var condi = [];
                for (key in newValueDict) {
                            condi.push("| eval " + key + '="' + newValueDict[key] + '"' );
                }
                s.push(condi.join("") + "]");
				return s.join("");
            }
			
            tableModule.getHiddenFields = function() {
                return {};
            }

			tableModule.onEditAllClick = function(evt) {
                var button = $(evt.target);
                oldValueDict = {};
                newValueDict = {};
				var thisthing = this;
				var context = thisthing.getContext();
				var s = "| inputlookup app_thresholds.csv ";
				//var context = this.getContext();
                $(button.parents("tbody")[0]).find("tr").slice(1).each(function() {
					oldValueDict = {};
					newValueDict = {};
					$(this).find("input").each(function(){
						
						var field = $(this).attr("s:field");
						var newValue = $(this).val();
						var oldValue = $(this).attr("s:oldValue") || "";
						
						newValueDict[field] = newValue;
						oldValueDict[field] = oldValue;
					});
					
					
					
					//s.append(thisthing.getRowUpdateSearch(lookupName,oldValueDict, newValueDict));
					s = s.concat(thisthing.getRowUpdateAllFilter(oldValueDict));
					s = s.concat(thisthing.getRowUpdateAllAppend(newValueDict));
				});
				var lookupName = context.get("lookupName.rawValue");
				s = s.concat("| outputlookup " + lookupName);
				console.log(s);
				window.__pageOffset = context.get("results.offset");
				window.__rowUpdater._params["search"] = s.replace(/\$/g, "$$$");
				window.__rowUpdater.pushContextToChildren();
            }


			tableModule.onEditClick = function(evt) {
                var button = $(evt.target);
                oldValueDict = {};
                newValueDict = {};
                $(button.parents("tr")[0]).find("input").each(function() {
                    var field = $(this).attr("s:field");
                    var newValue = $(this).val();
                    var oldValue = $(this).attr("s:oldValue") || "";
                    
                    newValueDict[field] = newValue;
                    oldValueDict[field] = oldValue;
                });
                var context = this.getContext();
                var lookupName = context.get("lookupName.rawValue");
                var s = this.getRowUpdateSearch(lookupName,oldValueDict, newValueDict);
				
                window.__pageOffset = context.get("results.offset");
                window.__rowUpdater._params["search"] = s.replace(/\$/g, "$$$");
                window.__rowUpdater.pushContextToChildren();
            }
			
            tableModule.onDeleteClick = function(evt) {
                var button = $(evt.target);
                oldValueDict = {};
                $(button.parents("tr")[0]).find("input").each(function() {
                    var field = $(this).attr("s:field");
                    var oldValue = $(this).attr("s:oldValue") || "";
                    oldValueDict[field] = oldValue;
                });
				console.log(this);
                var context = this.getContext();
                var lookupName = context.get("lookupName.rawValue");
                var s = this.getRowDeleteSearch(lookupName,oldValueDict);

                window.__pageOffset = context.get("results.offset");
                window.__rowDeleter._params["search"] = s.replace(/\$/g, "$$$");
                window.__rowDeleter.pushContextToChildren();
            }

            var renderRowMethodReference = tableModule.renderRow.bind(tableModule);
            tableModule.renderRow = function(table,rowIndex, row, context) {
                var tr = renderRowMethodReference(table,rowIndex, row, context);
                
				var editButton = $("<button>")
                    .addClass("splButton-secondary")
                    .addClass("update")
                    .text("Update")
                    .click(this.onEditClick.bind(this));
                var editAllButton = $("<button>")
                    .addClass("splButton-secondary")
                    .addClass("update")
                    .text("UpdateAll")
                    .click(this.onEditAllClick.bind(this));
                var deleteButton = $("<button>")
                    .addClass("splButton-secondary")
                    .addClass("delete")
                    .text("Delete")
                    .click(this.onDeleteClick.bind(this));
                
                var buttonCell = $("<td>")
                    .append(editButton)
					.append(editAllButton)
                    .append(deleteButton);
                tr.append(buttonCell);
                return tr;
            }

            onContextChangeMethodReference = tableModule.onContextChange.bind(tableModule);
            tableModule.onContextChange = function() {
                window.__pageOffset = null;
                return onContextChangeMethodReference();
            }
            tableModule.getTimeFormatPostProcess = function() {return false;}
        });        
    }

    Sideview.utils.declareCustomBehavior("clearMessagesOnContextChange", function(module) {
        onContextChangeReference = module.onContextChange.bind(module);
        module.onContextChange = function() {
            clearMessages();
            return onContextChangeReference();
        }
    });

    Sideview.utils.declareCustomBehavior("addNewFilterToFilterBar", function(module) {
        module.onContextChange = function() {
            var context = this.getContext();
            var callback = context.get("filters.addNewFilter");
            var field = context.get("field");
            var operator = context.get("operator");
            var value = context.get("value");
            callback(field,value,operator);
        }
    });

    Sideview.utils.declareCustomBehavior("hideDownstreamModulesUntilFieldSelected", function(pulldown) {
        var visibilityId = "userHasntPickedAFieldYet";
        var pushContextToChildrenReference = pulldown.pushContextToChildren.bind(pulldown);
        pulldown.pushContextToChildren = function(explicitContext) {
            var active = this.select.val().length>0;
            this.withEachDescendant(function(module) {
                if (active) {
                    module.show(visibilityId);
                } 
                else {
                    module.hide(visibilityId);
                }
            }.bind(this))
            
            if (active) {
                return pushContextToChildrenReference(explicitContext);
            }
        }
    });
        
        
    Sideview.utils.declareCustomBehavior("activeOnlyIfManualEntrySelected", function(module) {
        var onContextChangeReference = module.onContextChange.bind(module);
        module.onContextChange = function() {
            var retVal = onContextChangeReference();
            var context = this.getContext();
            if (context.get("value")) {
                this.active=false;
                this.hide();
            }
            else {
                this.active=true;
                this.show();
            }
            return retVal;
        }
        var getModifiedContextReference = module.getModifiedContext.bind(module);
        module.getModifiedContext = function() {
            if (this.active) {
                return getModifiedContextReference();
            } else {
                return this.getContext();
            }
        }
    });

})      


function clearMessages() {
    var messenger = Splunk.Messenger.System.getInstance();
    messenger.send('info', 'control', 'CLEAR', null, true);
}